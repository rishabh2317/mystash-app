import type { ImportProgressRepository } from './ImportProgressRepository';
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
    private readonly countPlaceCards: (userImportId: string) => Promise<number> = async () => 0,
    private readonly results?: {
      progress: ImportProgressRepository;
      placeCounts(sourceId: string): Promise<{ total: number; resolved: number; unverified: number }>;
      syncPlaces(row: { id: string; userId: string; contentSourceId: string | null }): Promise<void>;
    },
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
      await this.repo.restart(existing.id, new Date(this.nowMs()).toISOString());
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
      await this.repo.restart(raced.id, new Date(this.nowMs()).toISOString());
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
    const input = { id: record.id, userId: record.userId, contentSourceId: record.contentSourceId };
    try {
      await this.results?.syncPlaces(input);
    } catch {
      // A later submission or processing fan-out retries place membership.
    }
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
      // Read completion first, then committed entities. Reading counts first can
      // observe zero followed by COMPLETE and incorrectly stop frontend polling.
      const progress = row.contentSourceId ? await this.results?.progress.get(row.contentSourceId) : null;
      const currentProgress = progress && (!source?.queuedAt || Date.parse(progress.startedAt) >= Date.parse(source.queuedAt))
        ? progress : null;
      const placeCardCount = await this.countPlaceCards(row.id);
      const progressSource = source
        ? {
            processingStatus: source.processingStatus,
            candidateCount: source.candidateCount,
            placeCardCount,
          }
        : null;
      const progressInput = {
        source: progressSource,
        timedOutAt: row.timedOutAt,
        createdAt: row.createdAt,
        attemptStartedAt: row.attemptStartedAt,
        nowMs,
      };
      if (shouldPersistImportTimeout(progressInput)) {
        const current = await this.repo.markTimedOut(row.id, new Date(nowMs).toISOString(), row.attemptStartedAt ?? null);
        row.timedOutAt = current?.timedOutAt ?? null;
        progressInput.attemptStartedAt = current?.attemptStartedAt;
      }
      const state = resolveShareProgressState({
        ...progressInput,
        timedOutAt: row.timedOutAt,
      });
      const productCount =
        state === 'ready' && source && source.processingStatus === 'READY'
          ? source.candidateCount
          : 0;
      const resultProducts = row.contentSourceId
        ? mapBoundProducts(await this.contentSource.listProducts(row.contentSourceId)) : [];
      const products = state === 'ready' && productCount > 0 ? resultProducts : [];
      // New consumers get persisted discoveries even while the sibling branch is
      // running or failed. Legacy fields above deliberately retain their old contract.
      const uniqueProducts = [...new Map(resultProducts.map((p) => [p.productId, p])).values()];
      const places = row.contentSourceId && this.results
        ? await this.results.placeCounts(row.contentSourceId)
        : { total: placeCardCount, resolved: 0, unverified: placeCardCount };
      const fallbackStatus = source?.processingStatus === 'FAILED' ? 'failed'
        : source?.processingStatus === 'READY' ? 'complete' : 'running';
      let productStatus = currentProgress?.products ?? fallbackStatus;
      let placeStatus: 'running' | 'complete' | 'failed' | 'unknown' = currentProgress?.places
        ?? (source?.mediaKind === 'WEB_PAGE' ? 'complete'
          : fallbackStatus === 'complete' ? 'unknown' : fallbackStatus);
      if (row.timedOutAt) {
        if (productStatus === 'running') productStatus = 'failed';
        if (placeStatus === 'running') placeStatus = 'failed';
      }
      out.push({
        resultVersion: 1,
        timedOut: Boolean(row.timedOutAt),
        resultProductCount: uniqueProducts.length,
        resultProducts: uniqueProducts,
        placeCount: places.total,
        resolvedPlaceCount: places.resolved,
        unverifiedPlaceCount: places.unverified,
        productStatus,
        placeStatus,
        hasInFlight: !row.timedOutAt && (productStatus === 'running' || placeStatus === 'running'
          || (source?.processingStatus === 'PROCESSING' && currentProgress?.evidenceComplete === false)),
        canRetry: productStatus !== 'running' && placeStatus !== 'running'
          && (productStatus === 'failed' || placeStatus === 'failed' || Boolean(row.timedOutAt)),
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
    const input = { source, timedOutAt: row.timedOutAt, createdAt: row.createdAt,
      attemptStartedAt: row.attemptStartedAt, nowMs: this.nowMs() };
    if (!shouldPersistImportTimeout(input)) return false;
    const current = await this.repo.markTimedOut(row.id, new Date(this.nowMs()).toISOString(), row.attemptStartedAt ?? null);
    return Boolean(current?.timedOutAt);
  }

  /**
   * Explicit retry from Activity/Shares. Clears timeout freeze, re-queues processing,
   * syncs Bag if already resolved. Idempotent cart adds prevent duplicate Bag lines.
   */
  async retry(userId: string, importId: string): Promise<UserImportRecord> {
    if (!userId) throw new UserImportServiceError('userId required', 401);
    if (!importId) throw new UserImportServiceError('importId required', 400);
    const row = await this.repo.findById(importId);
    if (!row || row.userId !== userId || row.hiddenAt) {
      throw new UserImportServiceError('Import not found', 404);
    }
    await this.repo.restart(row.id, new Date(this.nowMs()).toISOString());
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
