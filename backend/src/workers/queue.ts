import { Queue } from 'bullmq';
import { getPipelineConfig } from '../config/pipelineConfig';

export const INGEST_QUEUE_NAME = 'ingest-pipeline';

export type IngestPipelineJobData = {
  ingestRequestId: string;
  traceId: string;
};

let queue: Queue<IngestPipelineJobData> | null = null;

export function getIngestQueue(): Queue<IngestPipelineJobData> {
  if (queue) return queue;
  const cfg = getPipelineConfig();
  queue = new Queue<IngestPipelineJobData>(INGEST_QUEUE_NAME, {
    connection: { url: cfg.redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 4000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return queue;
}

export async function enqueueIngestPipeline(data: IngestPipelineJobData): Promise<string> {
  const q = getIngestQueue();
  const job = await q.add('run', data, {
    jobId: `ingest-${data.ingestRequestId}`,
  });
  return job.id ?? data.ingestRequestId;
}
