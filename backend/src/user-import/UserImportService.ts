import { findPresentation } from './find/presentation';
import { type FindMembershipCounts } from './find/outcome';
import { rankForIntent } from './share/intentRanking';
import { getEnv } from '../env';
import { buildUserImportEventPayload } from './domain/events';
import {
  normalizeSharedInput,
  userImportDedupeKey,
  type SharedInputRejection,
} from './domain/sharedInput';
import type {
  ShareProgressItem,
  ShareProgressPrimaryProduct,
  SubmitUserImportInput,
  SubmitUserImportResult,
  UserImportRecord,
} from './domain/types';
import { emitUserImportEvent } from './observability';
import type { UserImportBagSyncPort, UserImportContentSourcePort } from './ports';
import type { UserImportRepository } from './UserImportRepository';

export class UserImportServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
    /** Internal classification for logs; not part of the HTTP body. */
    readonly reason?: SharedInputRejection,
  ) {
    super(message);
    this.name = 'UserImportServiceError';
  }
}

/** User-facing copy only — no internal parser or pipeline detail. */
const REJECTION_MESSAGES: Record<SharedInputRejection, string> = {
  EMPTY_INPUT: 'url required',
  INPUT_TOO_LONG: 'Shared text is too long',
  NO_URL_FOUND: 'Could not find a link in the shared text',
  UNSUPPORTED_SCHEME: 'Only http and https links can be imported',
  MALFORMED_URL: 'That link is not a valid URL',
  CREDENTIALS_IN_URL: 'That link cannot be imported',
  PRIVATE_DESTINATION: 'That link cannot be imported',
};

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '23505' || Boolean(e.message?.toLowerCase().includes('duplicate'));
}

function mapBoundProducts(
  products: Array<{
    catalogProductId: string | null;
    discoveredProductId: string | null;
    name: string;
    image: string | null;
  }>,
): ShareProgressPrimaryProduct[] {
  const out: ShareProgressPrimaryProduct[] = [];
  for (const p of products) {
    const productId = p.catalogProductId ?? p.discoveredProductId;
    if (!productId) continue;
    out.push({
      productId,
      title: p.name,
      imageUrl: p.image,
    });
  }
  return out;
}

/**
 * User Import application boundary — submission SoT.
 *
 * Accepts a share durably, links it to its global content source, and hands processing to
 * the existing queue. Extraction and matching stay on the content-source worker. When the
 * source is already resolved, Bag membership is applied through the optional sync port.
 */
export class UserImportService {
  constructor(
    private readonly repo: UserImportRepository,
    private readonly contentSource: UserImportContentSourcePort,
    private readonly bagSync: UserImportBagSyncPort | null = null,
    private readonly results?: {
      memberships(userId: string, ids: string[]): Promise<Map<string, FindMembershipCounts>>;
      syncPlaces(row: { id: string; userId: string; contentSourceId: string | null }): Promise<void>;
    },
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async submit(
    userId: string,
    input: SubmitUserImportInput,
  ): Promise<SubmitUserImportResult> {
    if (!userId) throw new UserImportServiceError('userId required', 401);

    const normalized = normalizeSharedInput(input?.rawInput);
    if (!normalized.ok) {
      emitUserImportEvent(
        'UserImportRejected',
        buildUserImportEventPayload({
          userId,
          importId: null,
          platform: null,
          status: null,
          reason: normalized.reason,
        }),
      );
      throw new UserImportServiceError(
        REJECTION_MESSAGES[normalized.reason],
        400,
        normalized.reason,
      );
    }

    const { rawInput, sourceUrl, normalizedUrl, platform } = normalized.value;
    const dedupeKey = userImportDedupeKey(normalizedUrl);

    const existing = await this.repo.findByUserAndDedupeKey(userId, dedupeKey);
    if (existing) {
      // Deliberate re-share: start a new capture attempt and retry processing.
      await this.repo.restart(existing.id, new Date(this.nowMs()).toISOString());
      await this.retryProcessing(existing);
      await this.syncBag(existing);
      const refreshed = (await this.repo.findById(existing.id)) ?? existing;
      return this.received(refreshed, false);
    }

    const source = await this.contentSource.getOrCreate(normalizedUrl);

    try {
      const record = await this.repo.insert({
        userId,
        rawInput,
        sourceUrl,
        normalizedUrl,
        dedupeKey,
        platform,
        contentSourceId: source.record.id,
        status: 'RECEIVED',
      });
      await this.contentSource.requestProcessing({
        contentSource: source.record,
        userImportId: record.id,
      });
      await this.syncBag(record);
      return this.received(record, true);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.repo.findByUserAndDedupeKey(userId, dedupeKey);
      if (!raced) throw err;
      await this.repo.restart(raced.id, new Date(this.nowMs()).toISOString());
      await this.retryProcessing(raced);
      await this.syncBag(raced);
      const refreshed = (await this.repo.findById(raced.id)) ?? raced;
      return this.received(refreshed, false);
    }
  }

  /** Best-effort re-handoff for an already-accepted submission. Never throws. */
  private async retryProcessing(record: UserImportRecord): Promise<void> {
    if (!record.contentSourceId) return;
    const contentSource = await this.contentSource.getById(record.contentSourceId);
    if (!contentSource) return;
    await this.contentSource.requestProcessing({ contentSource, userImportId: record.id });
  }

  private async syncBag(record: UserImportRecord): Promise<void> {
    const input = { id: record.id, userId: record.userId, contentSourceId: record.contentSourceId };
    try {
      await this.results?.syncPlaces(input);
    } catch {
      // Durable consumer recovery retries this membership independently of extraction.
    }
    if (!this.bagSync) return;
    try {
      await this.bagSync.applyIfResolved({
        id: record.id,
        userId: record.userId,
        contentSourceId: record.contentSourceId,
      });
    } catch {
      // The persisted sync marker remains retryable by consumer recovery.
    }
  }

  private received(
    record: SubmitUserImportResult['record'],
    created: boolean,
  ): SubmitUserImportResult {
    emitUserImportEvent(
      'UserImportReceived',
      buildUserImportEventPayload({
        userId: record.userId,
        importId: record.id,
        platform: record.platform,
        contentSourceId: record.contentSourceId,
        status: record.status,
        created,
      }),
    );
    return { record, created };
  }

  async listRecent(userId: string): Promise<ShareProgressItem[]> {
    if (!userId) throw new UserImportServiceError('userId required', 401);
    const rows = await this.repo.listByUser(userId, 20);
    if (!this.results) throw new UserImportServiceError('Find status unavailable', 503);
    const memberships = await this.results.memberships(userId, rows.map(r => r.id));
    return Promise.all(rows.filter(row=>row.platform!=='image').map(async row => {
      if(!row.sourceUrl)throw new UserImportServiceError('URL source unavailable',503);
      const membership = memberships.get(row.id);
      if (!membership) throw new UserImportServiceError('Find status unavailable', 503);
      const outcome = membership.outcome;
      const bound = [...(row.contentSourceId ? mapBoundProducts(await this.contentSource.listProducts(row.contentSourceId)) : []), ...membership.selectedProducts];
      const ranked = getEnv('SHARE_INTENT_ENABLED') === 'true'
        ? rankForIntent(bound, { kind: row.interestKind ?? null, note: row.interestNote ?? null }, p => p.title) : bound;
      const products = [...new Map(ranked.map(p => [p.productId, p])).values()];
      return { ...findPresentation(outcome, products), importId: row.id,
        kind: row.platform === 'instagram' || row.platform === 'youtube' ? row.platform : 'web',
        createdAt: row.createdAt, contentSourceId: row.contentSourceId, sourceUrl: row.sourceUrl };
    }));
  }


  /**
   * Explicit retry from Activity/Shares. Re-queues failed extraction,
   * syncs Bag if already resolved. Idempotent cart adds prevent duplicate Bag lines.
   */
  async retry(userId: string, importId: string, mode: 'auto' | 'extraction' | 'saving' = 'auto'): Promise<UserImportRecord> {
    if (!userId) throw new UserImportServiceError('userId required', 401);
    if (!importId) throw new UserImportServiceError('importId required', 400);
    const row = await this.repo.findById(importId);
    if (!row || row.userId !== userId || row.hiddenAt) {
      throw new UserImportServiceError('Import not found', 404);
    }
    if (!this.results) throw new UserImportServiceError('Find status unavailable', 503);
    const membership = (await this.results.memberships(userId, [row.id])).get(row.id);
    if (!membership) throw new UserImportServiceError('Find status unavailable', 503);
    const outcome = membership.outcome;
    if (mode === 'saving' || (mode === 'auto' && outcome.canRetrySaving && !outcome.canRetryExtraction)) {
      if (!outcome.canRetrySaving) throw new UserImportServiceError('Saving cannot be retried for this find', 409);
      await this.syncBag(row);
      return (await this.repo.findById(row.id)) ?? row;
    }
    if (!outcome.canRetryExtraction) throw new UserImportServiceError('This find cannot be retried while work is active or complete', 409);
    const restarted = await this.repo.restartVisibleForRetry(row.id, userId, new Date(this.nowMs()).toISOString(), row.attemptStartedAt ?? null);
    if (!restarted) throw new UserImportServiceError('This find changed before retry', 409);
    if (row.contentSourceId) {
      const contentSource = await this.contentSource.getById(row.contentSourceId);
      if (contentSource) {
        await this.contentSource.requestReprocessing({
          contentSource,
          userImportId: row.id,
        });
      }
    }
    const refreshed = (await this.repo.findById(row.id)) ?? restarted;
    await this.syncBag(refreshed);
    return refreshed;
  }

  /** Remove this user's import history row only — never deletes content_sources. */
  async delete(userId: string, importId: string): Promise<void> {
    if (!userId) throw new UserImportServiceError('userId required', 401);
    if (!importId) throw new UserImportServiceError('importId required', 400);
    const row = await this.repo.findById(importId);
    if (!row || row.userId !== userId) {
      throw new UserImportServiceError('Import not found', 404);
    }
    const deleted = await this.repo.deleteForUser(importId, userId);
    if (!deleted) throw new UserImportServiceError('Import not found', 404);
  }
}
