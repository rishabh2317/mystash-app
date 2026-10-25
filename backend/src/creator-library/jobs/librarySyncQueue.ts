import { Queue } from 'bullmq';
import { getBullmqConnection, resolveRedisAvailability, shouldBypassBullmqEnqueue, withTimeout } from '../../workers/redisConnection';

export const CREATOR_LIBRARY_SYNC_QUEUE = 'creator-library-sync';

export type CreatorLibrarySyncJobData = {
  userId: string;
  connectedAccountId: string;
  runStartedAt: string;
  pageToken: string | null;
  uploadsPlaylistId: string | null;
};

let queue: Queue<CreatorLibrarySyncJobData> | null = null;

export function getCreatorLibrarySyncQueue(): Queue<CreatorLibrarySyncJobData> {
  if (queue) return queue;
  queue = new Queue<CreatorLibrarySyncJobData>(CREATOR_LIBRARY_SYNC_QUEUE, {
    connection: getBullmqConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 8000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return queue;
}

/** BullMQ custom ids cannot contain ":" (unless they are exactly three segments). */
function jobIdSegment(value: string): string {
  return value.replace(/:/g, '-');
}

/**
 * One id per account, sync run, and page. Continuation jobs keep `runStartedAt`
 * and change only the page token, so a retried page collapses onto the same id.
 * Hyphens match the other queue ids (`content-source-…`, `ingest-…`).
 */
export function librarySyncJobId(data: CreatorLibrarySyncJobData): string {
  const page = data.pageToken ? data.pageToken.slice(0, 24) : 'start';
  return `library-sync-${jobIdSegment(data.connectedAccountId)}-${jobIdSegment(data.runStartedAt)}-${jobIdSegment(page)}`;
}

export async function enqueueCreatorLibrarySync(data: CreatorLibrarySyncJobData): Promise<string> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    throw new Error('Sync queue is unavailable');
  }
  const q = getCreatorLibrarySyncQueue();
  const jobId = librarySyncJobId(data);
  try {
    const job = await withTimeout(
      q.add('sync', data, { jobId }),
      5_000,
      'creator_library.enqueue',
    );
    return job.id ?? jobId;
  } catch (err) {
    const message = String((err as { message?: string })?.message ?? '').toLowerCase();
    if (message.includes('job') && message.includes('exist')) return jobId;
    throw err;
  }
}
