import { enqueueUserImportTimeout } from '../content-source/jobs/contentSourceQueue';
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
import {
  resolveShareProgressState,
  shouldPersistImportTimeout,
  shareProgressState,
} from './domain/shareProgress';
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
    private readonly scheduleTimeout: (userImportId: string) => Promise<void> = defaultScheduleTimeout,
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
      // Deliberate re-share: clear a prior timeout freeze and retry processing.
      if (existing.timedOutAt) {
        await this.repo.clearTimedOut(existing.id);
      }
      await this.retryProcessing(existing);
      await this.syncBag(existing);
      await this.scheduleTimeout(existing.id);
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
      await this.scheduleTimeout(record.id);
      return this.received(record, true);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.repo.findByUserAndDedupeKey(userId, dedupeKey);
      if (!raced) throw err;
      if (raced.timedOutAt) {
        await this.repo.clearTimedOut(raced.id);
      }
      await this.retryProcessing(raced);
      await this.syncBag(raced);
      await this.scheduleTimeout(raced.id);
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
    if (!this.bagSync) return;
    try {
      await this.bagSync.applyIfResolved({
        id: record.id,
        userId: record.userId,
        contentSourceId: record.contentSourceId,
      });
    } catch {
      // Membership is retried on the next share of this source.
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
    const out: ShareProgressItem[] = [];
    const nowMs = this.nowMs();
    for (const row of rows) {
      const source = row.contentSourceId
        ? await this.contentSource.getById(row.contentSourceId)
        : null;
      const progressInput = {
        source,
        timedOutAt: row.timedOutAt,
        createdAt: row.createdAt,
        nowMs,
      };
      if (shouldPersistImportTimeout(progressInput)) {
        await this.repo.markTimedOut(row.id, new Date(nowMs).toISOString());
        row.timedOutAt = new Date(nowMs).toISOString();
      }
      const state = resolveShareProgressState({
        ...progressInput,
        timedOutAt: row.timedOutAt,
      });
      const productCount =
        state === 'ready' && source && source.processingStatus === 'READY'
          ? source.candidateCount
          : 0;
      let products: ShareProgressPrimaryProduct[] = [];
      if (row.contentSourceId && state === 'ready' && productCount > 0) {
        products = mapBoundProducts(await this.contentSource.listProducts(row.contentSourceId));
      }
      out.push({
        importId: row.id,
        state,
        kind: row.platform === 'instagram' || row.platform === 'youtube' ? row.platform : 'web',
        createdAt: row.createdAt,
        productCount: state === 'ready' ? productCount : 0,
        contentSourceId: row.contentSourceId,
        sourceUrl: row.sourceUrl,
        primaryProduct: products[0] ?? null,
        products,
      });
    }
    return out;
  }

  /** Apply timeout from the delayed worker. Idempotent; never touches content_sources. */
  async applyTimeout(userImportId: string): Promise<boolean> {
    const row = await this.repo.findById(userImportId);
    if (!row || row.timedOutAt) return false;
    const source = row.contentSourceId
      ? await this.contentSource.getById(row.contentSourceId)
      : null;
    if (shareProgressState(source) !== 'looking') return false;
    await this.repo.markTimedOut(row.id, new Date(this.nowMs()).toISOString());
    return true;
  }

  /**
   * Explicit retry from Activity/Shares. Clears timeout freeze, re-queues processing,
   * syncs Bag if already resolved. Idempotent cart adds prevent duplicate Bag lines.
   */
  async retry(userId: string, importId: string): Promise<UserImportRecord> {
    if (!userId) throw new UserImportServiceError('userId required', 401);
    if (!importId) throw new UserImportServiceError('importId required', 400);
    const row = await this.repo.findById(importId);
    if (!row || row.userId !== userId) {
      throw new UserImportServiceError('Import not found', 404);
    }
    if (row.timedOutAt) {
      await this.repo.clearTimedOut(row.id);
    }
    if (row.contentSourceId) {
      const contentSource = await this.contentSource.getById(row.contentSourceId);
      if (contentSource) {
        await this.contentSource.requestReprocessing({
          contentSource,
          userImportId: row.id,
        });
      }
    }
    const refreshed = (await this.repo.findById(row.id)) ?? row;
    await this.syncBag(refreshed);
    await this.scheduleTimeout(refreshed.id);
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

async function defaultScheduleTimeout(userImportId: string): Promise<void> {
  try {
    await enqueueUserImportTimeout({ userImportId });
  } catch {
    // Best-effort; GET /imports self-heals.
  }
}
