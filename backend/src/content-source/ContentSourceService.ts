import { getPipelineConfig } from '../config/pipelineConfig';
import type { ContentSourceRepository } from './ContentSourceRepository';
import { buildContentSourceEventPayload } from './domain/events';
import { resolveContentSourceIdentity } from './domain/identity';
import { shouldEnqueueProcessing } from './domain/lifecycle';
import type {
  ContentSourceRecord,
  RequestProcessingResult,
  ResolveContentSourceResult,
} from './domain/types';
import { contentSourceProcessingJobId } from './jobs/contentSourceQueue';
import { emitContentSourceEvent } from './observability';
import type { ContentProcessingQueuePort } from './ports';

export class ContentSourceServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ContentSourceServiceError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '23505' || Boolean(e.message?.toLowerCase().includes('duplicate'));
}

/**
 * Content Source application boundary — global content identity plus the async handoff.
 *
 * Owns no product data: no extraction, no AI, no Catalog write, no Bag write. Phase 2
 * responsibility ends when a processing job has been handed to the existing BullMQ stack.
 */
export class ContentSourceService {
  constructor(
    private readonly repo: ContentSourceRepository,
    private readonly queue: ContentProcessingQueuePort,
  ) {}

  async getById(id: string): Promise<ContentSourceRecord | null> {
    return this.repo.findById(id);
  }

  async listBoundSourceIds(bind: {
    catalogProductId?: string | null;
    discoveredProductId?: string | null;
  }): Promise<string[]> {
    return this.repo.listBoundSourceIds(bind);
  }

  /**
   * Atomic get-or-create for the global identity of `normalizedUrl`.
   *
   * The `(platform, external_id)` unique constraint is the authority: a concurrent loser
   * catches the uniqueness violation and re-reads the winner's row.
   */
  async getOrCreate(normalizedUrl: string): Promise<ResolveContentSourceResult> {
    const identity = resolveContentSourceIdentity(normalizedUrl);

    const existing = await this.repo.findByIdentity(identity);
    if (existing) return this.reused(existing);

    try {
      const record = await this.repo.insert({
        ...identity,
        processingStatus: 'RECEIVED',
        pipelineVersion: getPipelineConfig().pipelineVersion,
      });
      emitContentSourceEvent(
        'ContentSourceCreated',
        buildContentSourceEventPayload({
          contentSourceId: record.id,
          platform: record.platform,
          externalId: record.externalId,
          mediaKind: record.mediaKind,
          processingStatus: record.processingStatus,
        }),
      );
      return { record, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findByIdentity(identity);
      if (!winner) throw err;
      return this.reused(winner);
    }
  }

  /**
   * Hands global processing work to the queue, at most once per content source.
   *
   * Never throws: a user's import is already durably accepted by the time this runs, so an
   * enqueue failure is recorded and left recoverable (the row stays RECEIVED) rather than
   * failing the request.
   */
  async requestProcessing(params: {
    contentSource: ContentSourceRecord;
    userImportId: string;
  }): Promise<RequestProcessingResult> {
    const { contentSource, userImportId } = params;
    const base = {
      contentSourceId: contentSource.id,
      platform: contentSource.platform,
      externalId: contentSource.externalId,
      mediaKind: contentSource.mediaKind,
      userImportId,
    };

    if (!shouldEnqueueProcessing(contentSource.processingStatus)) {
      emitContentSourceEvent(
        'ContentSourceProcessingSuppressed',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: contentSource.processingStatus,
          jobId: contentSourceProcessingJobId(contentSource.id),
          reason: 'already_queued_or_processed',
        }),
      );
      return { queued: false, suppressed: true, enqueueFailed: false, jobId: null };
    }

    try {
      const jobId = await this.queue.enqueue({
        contentSourceId: contentSource.id,
        userImportId,
      });
      // Compare-and-set: a concurrent share that won the transition leaves this null,
      // which is still correct — BullMQ collapsed both onto one job id.
      const queued = await this.repo.markQueued(contentSource.id, new Date().toISOString());
      emitContentSourceEvent(
        'ContentSourceProcessingQueued',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: queued?.processingStatus ?? contentSource.processingStatus,
          jobId,
        }),
      );
      return { queued: true, suppressed: false, enqueueFailed: false, jobId };
    } catch (err) {
      emitContentSourceEvent(
        'ContentSourceEnqueueFailed',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: contentSource.processingStatus,
          reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }),
      );
      return { queued: false, suppressed: false, enqueueFailed: true, jobId: null };
    }
  }

  private reused(record: ContentSourceRecord): ResolveContentSourceResult {
    emitContentSourceEvent(
      'ContentSourceReused',
      buildContentSourceEventPayload({
        contentSourceId: record.id,
        platform: record.platform,
        externalId: record.externalId,
        mediaKind: record.mediaKind,
        processingStatus: record.processingStatus,
      }),
    );
    return { record, created: false };
  }
}
