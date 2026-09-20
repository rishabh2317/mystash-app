import { Queue } from 'bullmq';
import {
  getBullmqConnection,
  REDIS_UNAVAILABLE_ENQUEUE_ERROR,
  resolveRedisAvailability,
  shouldBypassBullmqEnqueue,
  withTimeout,
} from '../../workers/redisConnection';
import {
  CONTENT_SOURCE_QUEUE,
  contentSourceProcessingJobId,
  type ContentSourceProcessingJobData,
} from './jobIdentity';

export {
  CONTENT_SOURCE_QUEUE,
  contentSourceProcessingJobId,
  type ContentSourceProcessingJobData,
} from './jobIdentity';

let contentSourceQueue: Queue<ContentSourceProcessingJobData> | null = null;

export function getContentSourceProcessingQueue(): Queue<ContentSourceProcessingJobData> {
  if (contentSourceQueue) return contentSourceQueue;
  contentSourceQueue = new Queue<ContentSourceProcessingJobData>(CONTENT_SOURCE_QUEUE, {
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

export async function enqueueContentSourceProcessing(
  data: ContentSourceProcessingJobData,
): Promise<string> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    throw new Error(REDIS_UNAVAILABLE_ENQUEUE_ERROR);
  }
  const q = getContentSourceProcessingQueue();
  const jobId = contentSourceProcessingJobId(data.contentSourceId);
  const job = await withTimeout(
    q.add('process', data, { jobId }),
    5_000,
    'content_source.enqueue',
  );
  return job.id ?? jobId;
}
