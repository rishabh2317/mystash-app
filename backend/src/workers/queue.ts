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
  const job = await withTimeout(
    q.add('run', data, {
      jobId: `ingest-${data.ingestRequestId}`,
    }),
    ENQUEUE_TIMEOUT_MS,
    'ingest.enqueue',
  );
  return job.id ?? data.ingestRequestId;
}
