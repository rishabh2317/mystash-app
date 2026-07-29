import { Worker } from 'bullmq';
import { logger } from '../logger';
import { createSupabaseAdmin } from '../supabase';
import { runProgressiveIngestPipeline } from '../stages/orchestrator';
import { INGEST_QUEUE_NAME, type IngestPipelineJobData } from './queue';
import { getBullmqConnection } from './redisConnection';

export function startIngestPipelineWorker(): Worker<IngestPipelineJobData> {
  const admin = createSupabaseAdmin();

  const worker = new Worker<IngestPipelineJobData>(
    INGEST_QUEUE_NAME,
    async (job) => {
      const { ingestRequestId, traceId } = job.data;
      logger.info({ ingestRequestId, traceId, jobId: job.id }, 'ingest.worker.start');
      const result = await runProgressiveIngestPipeline(admin, ingestRequestId, traceId);
      logger.info({ ingestRequestId, result }, 'ingest.worker.done');
      return result;
    },
    {
      connection: getBullmqConnection(),
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingest.worker.failed');
  });

  return worker;
}
