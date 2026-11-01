import { Worker } from 'bullmq';
import { logger } from '../logger';
import { createSupabaseAdmin } from '../supabase';
import { runProgressiveIngestPipeline } from '../stages/orchestrator';
import { getIngestQueue, INGEST_QUEUE_NAME, type IngestPipelineJobData } from './queue';
import { runClaimedIngest } from './ingestJobGate';
import { withFreeTestExtractionSlot } from './freeTestBudget';
import {
  duplicateBullmqWorkerRedis,
  resolveRedisAvailability,
  shouldBypassBullmqEnqueue,
} from './redisConnection';

export function startIngestPipelineWorker(): Worker<IngestPipelineJobData> {
  const worker = new Worker<IngestPipelineJobData>(
    INGEST_QUEUE_NAME,
    async (job) => withFreeTestExtractionSlot(async () => {
      const admin = createSupabaseAdmin();
      const { ingestRequestId, traceId } = job.data;
      logger.info({ ingestRequestId, traceId, jobId: job.id }, 'ingest.worker.start');
      const result = await runClaimedIngest(ingestRequestId, {
        readStatus: async id => {
          const { data, error } = await admin.from('ingest_requests').select('status').eq('id', id).maybeSingle();
          if (error) throw error;
          return data?.status ?? null;
        },
        run: id => runProgressiveIngestPipeline(admin, id, traceId),
      });
      logger.info({ ingestRequestId, result }, 'ingest.worker.done');
      return result;
    }),
    {
      connection: duplicateBullmqWorkerRedis('ingest-pipeline-worker'),
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingest.worker.failed');
  });

  void worker.waitUntilReady().then(
    () => logger.info('ingest.worker.redis_ready'),
    (err) => logger.warn({ err }, 'ingest.worker.redis_not_ready'),
  );
  void getIngestQueue().waitUntilReady().then(
    () => logger.info('ingest.queue.redis_ready'),
    (err) => logger.warn({ err }, 'ingest.queue.redis_not_ready'),
  );

  return worker;
}

/** Embedded API process: skip BullMQ worker when Redis is down so it cannot reconnect-loop. */
export async function startEmbeddedIngestPipelineWorker(): Promise<Worker<IngestPipelineJobData> | null> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    logger.info('ingest.worker.skipped_redis_unavailable');
    return null;
  }
  return startIngestPipelineWorker();
}
