import { Queue } from 'bullmq';
import {
  getBullmqConnection,
  REDIS_UNAVAILABLE_ENQUEUE_ERROR,
  resolveRedisAvailability,
  shouldBypassBullmqEnqueue,
  withTimeout,
} from '../../workers/redisConnection';
import { USER_IMPORT_TIMEOUT_MS } from '../../user-import/domain/shareProgress';
import {
  CONTENT_SOURCE_QUEUE,
  contentSourceEnrichmentJobId,
  contentSourceProcessingJobId,
  userImportTimeoutJobId,
  type ContentSourceEnrichmentJobData,
  type ContentSourceProcessingJobData,
  type ContentSourceQueueJobData,
  type UserImportTimeoutJobData,
} from './jobIdentity';

export {
  CONTENT_SOURCE_QUEUE,
  contentSourceEnrichmentJobId,
  contentSourceProcessingJobId,
  userImportTimeoutJobId,
  type ContentSourceEnrichmentJobData,
  type ContentSourceProcessingJobData,
  type ContentSourceQueueJobData,
  type UserImportTimeoutJobData,
} from './jobIdentity';

let contentSourceQueue: Queue<ContentSourceQueueJobData> | null = null;

export function getContentSourceProcessingQueue(): Queue<ContentSourceQueueJobData> {
  if (contentSourceQueue) return contentSourceQueue;
  contentSourceQueue = new Queue<ContentSourceQueueJobData>(CONTENT_SOURCE_QUEUE, {
    connection: getBullmqConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 8000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return contentSourceQueue;
}

function isJobExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = String((err as { message?: string }).message ?? '').toLowerCase();
  return message.includes('job') && message.includes('exist');
}

/**
 * Enqueue processing. If a completed/failed job still occupies the stable id, remove and
 * re-add so FAILED→QUEUED re-shares are not stuck forever.
 */
export async function enqueueContentSourceProcessing(
  data: ContentSourceProcessingJobData,
): Promise<string> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    throw new Error(REDIS_UNAVAILABLE_ENQUEUE_ERROR);
  }
  const q = getContentSourceProcessingQueue();
  const jobId = contentSourceProcessingJobId(data.contentSourceId);

  const add = () =>
    withTimeout(q.add('process', data, { jobId }), 5_000, 'content_source.enqueue');

  try {
    const job = await add();
    return job.id ?? jobId;
  } catch (err) {
    if (!isJobExistsError(err)) throw err;
    const existing = await q.getJob(jobId);
    if (!existing) throw err;
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
      const job = await add();
      return job.id ?? jobId;
    }
    // waiting | active | delayed | paused — another worker owns the work
    return existing.id ?? jobId;
  }
}

/** After Bag insertion — runs full merchant enrichment without blocking discovery. */
export async function enqueueContentSourceEnrichment(
  data: ContentSourceEnrichmentJobData,
): Promise<string | null> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    return null;
  }
  const q = getContentSourceProcessingQueue();
  const jobId = contentSourceEnrichmentJobId(data.discoveredProductId);
  try {
    const job = await withTimeout(
      q.add('enrich', data, { jobId }),
      5_000,
      'content_source.enrich.enqueue',
    );
    return job.id ?? jobId;
  } catch (err) {
    if (isJobExistsError(err)) return jobId;
    throw err;
  }
}

/**
 * Delayed hard timeout for a user import. Best-effort: GET /imports also self-heals.
 * Does not cancel global content_source processing.
 */
export async function enqueueUserImportTimeout(
  data: UserImportTimeoutJobData,
  delayMs: number = USER_IMPORT_TIMEOUT_MS,
): Promise<string | null> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    return null;
  }
  const q = getContentSourceProcessingQueue();
  const jobId = userImportTimeoutJobId(data.userImportId);
  try {
    const job = await withTimeout(
      q.add('user-import-timeout', data, {
        jobId,
        delay: Math.max(0, delayMs),
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 50,
      }),
      5_000,
      'user_import.timeout.enqueue',
    );
    return job.id ?? jobId;
  } catch (err) {
    if (isJobExistsError(err)) return jobId;
    // Timeout is best-effort; listRecent self-heal covers Redis blips.
    return null;
  }
}
