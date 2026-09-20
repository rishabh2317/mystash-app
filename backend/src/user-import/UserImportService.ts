import { buildUserImportEventPayload } from './domain/events';
import {
  normalizeSharedInput,
  userImportDedupeKey,
  type SharedInputRejection,
} from './domain/sharedInput';
import type {
  ShareProgressItem,
  SubmitUserImportInput,
  SubmitUserImportResult,
  UserImportRecord,
} from './domain/types';
import { shareProgressState } from './domain/shareProgress';
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
      // Re-sharing is the user-level retry: if the source was never queued (or failed),
      // this hands the work over again. Already-queued work is suppressed downstream.
      await this.retryProcessing(existing);
      await this.syncBag(existing);
      return this.received(existing, false);
    }

    // Durable order: global identity → user submission → queue handoff. The rows exist
    // before the job, so a queue failure never loses an accepted share.
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
      await this.retryProcessing(raced);
      await this.syncBag(raced);
      return this.received(raced, false);
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
    for (const row of rows) {
      const source = row.contentSourceId
        ? await this.contentSource.getById(row.contentSourceId)
        : null;
      out.push({
        importId: row.id,
        state: shareProgressState(source),
        kind: row.platform === 'instagram' || row.platform === 'youtube' ? row.platform : 'web',
      });
    }
    return out;
  }
}
