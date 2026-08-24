import { Queue } from 'bullmq';
import { logger } from '../logger';
import {
  describeRedisEnqueueState,
  getBullmqConnection,
  getBullmqCommandRedis,
  isCommandRedisReady,
  REDIS_UNAVAILABLE_ENQUEUE_ERROR,
  resolveRedisAvailability,
  shouldBypassBullmqEnqueue,
  withTimeout,
  type RedisEnqueueState,
} from './redisConnection';

export const INGEST_QUEUE_NAME = 'ingest-pipeline';
export const ENQUEUE_TIMEOUT_MS = 5_000;
export const QUEUE_READY_TIMEOUT_MS = 2_500;

export type IngestPipelineJobData = {
  ingestRequestId: string;
  traceId: string;
};

export type EnqueueableIngestQueue = {
  waitUntilReady(): Promise<unknown>;
  add(
    name: string,
    data: IngestPipelineJobData,
    opts: { jobId: string },
  ): Promise<{ id?: string }>;
  getJob(jobId: string): Promise<{ id?: string } | undefined | null>;
};

let queue: Queue<IngestPipelineJobData> | null = null;

export function getIngestQueue(): Queue<IngestPipelineJobData> {
  if (queue) return queue;
  queue = new Queue<IngestPipelineJobData>(INGEST_QUEUE_NAME, {
    connection: getBullmqConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 4000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return queue;
}

/**
 * If the shared command Redis client is already ready, skip Queue.waitUntilReady().
 * BullMQ's waitUntilReady waits on extra duplicated connections and is what
 * produced ingest.queue.ready timed out after 2500ms while Redis itself was up.
 */
export async function enqueueOnReadyQueue(
  q: EnqueueableIngestQueue,
  data: IngestPipelineJobData,
  timeouts: { readyMs?: number; addMs?: number } = {},
  redisState: RedisEnqueueState = { status: 'wait' },
): Promise<string> {
  const readyMs = timeouts.readyMs ?? QUEUE_READY_TIMEOUT_MS;
  const addMs = timeouts.addMs ?? ENQUEUE_TIMEOUT_MS;
  const jobId = `ingest-${data.ingestRequestId}`;

  logger.info({ ...redisState }, 'ingest.redis.enqueue_state');
  if (isCommandRedisReady(redisState)) {
    logger.info({ status: redisState.status }, 'ingest.queue.ready_skipped');
  } else {
    await withTimeout(q.waitUntilReady(), readyMs, 'ingest.queue.ready');
  }
  const addPromise = q.add('run', data, { jobId });

  try {
    const job = await withTimeout(addPromise, addMs, 'ingest.enqueue');
    return job.id ?? data.ingestRequestId;
  } catch (err) {
    // withTimeout does not cancel q.add. If Redis is slow, add may still succeed
    // after the race rejects — falling back to in-process would double-run.
    try {
      const existing = await withTimeout(q.getJob(jobId), 2_000, 'ingest.getJob');
      if (existing) {
        return existing.id ?? data.ingestRequestId;
      }
      const late = await Promise.race([
        addPromise,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 1_500);
        }),
      ]);
      if (late) {
        return late.id ?? data.ingestRequestId;
      }
    } catch {
      // fall through and rethrow original enqueue failure
    }
    throw err;
  }
}

export async function enqueueIngestPipeline(data: IngestPipelineJobData): Promise<string> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    throw new Error(REDIS_UNAVAILABLE_ENQUEUE_ERROR);
  }
  const redis = getBullmqCommandRedis();
  if (redis.status !== 'ready' && redis.status !== 'connecting' && redis.status !== 'connect') {
    await redis.connect().catch(() => undefined);
  }
  return enqueueOnReadyQueue(
    getIngestQueue(),
    data,
    {},
    describeRedisEnqueueState(redis),
  );
}
