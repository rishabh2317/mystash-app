import { Queue } from 'bullmq';
import { getBullmqConnection, withTimeout } from './redisConnection';

export const INGEST_QUEUE_NAME = 'ingest-pipeline';

export type IngestPipelineJobData = {
  ingestRequestId: string;
  traceId: string;
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

const ENQUEUE_TIMEOUT_MS = 5_000;

export async function enqueueIngestPipeline(data: IngestPipelineJobData): Promise<string> {
  const q = getIngestQueue();
  const jobId = `ingest-${data.ingestRequestId}`;
  const addPromise = q.add('run', data, { jobId });

  try {
    const job = await withTimeout(addPromise, ENQUEUE_TIMEOUT_MS, 'ingest.enqueue');
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
