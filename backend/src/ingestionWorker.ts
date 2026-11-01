/** Ingestion role only. Analytics and notification workers keep their existing owners. */
import 'dotenv/config';
import { readFileSync, statfsSync } from 'node:fs';
import type { Worker } from 'bullmq';
import { createSupabaseAdmin } from './supabase';
import { logger } from './logger';
import { getBullmqCommandRedis } from './workers/redisConnection';
import { assertPendingJobsApproved, pendingIngestionJobs, redisPersistenceHealthy,
  stoppedWorkers, validateIngestionAdmission } from './workers/ingestionRuntime';
import { startIngestPipelineWorker } from './workers/ingestPipelineWorker';
import { startProductResolveWorker } from './product-intelligence';
import { startProductAiReviewWorker } from './ai-review/jobs/productAiReviewQueue';
import { startContentSourceProcessingWorker } from './content-source/factory';
import { startCreatorLibrarySyncWorker } from './creator-library/jobs/librarySyncWorker';

// HTTP command clients remain fail-fast. This dedicated process must reconnect.
process.env.REDIS_REQUIRED = 'true';
const workers: Worker[] = [];
let closing = false;
let watchdog: ReturnType<typeof setInterval> | undefined;
async function shutdown(code: number) {
  if (closing) return;
  closing = true;
  if (watchdog) clearInterval(watchdog);
  // Drain active work rather than terminating a partially persisted extraction.
  await Promise.allSettled(workers.map(w => w.close()));
  getBullmqCommandRedis().disconnect();
  process.exit(code);
}
function add(worker: Worker | null) {
  if (!worker) throw new Error('An ingestion worker could not be initialized');
  workers.push(worker);
  worker.on('error', error => logger.error({ queue: worker.name, message: error.message.slice(0, 240) }, 'ingestion.worker.error'));
}
async function main() {
  const policyFile = process.env.MYSTASH_INGESTION_ADMISSION_FILE;
  if (!policyFile) throw new Error('Reviewed ingestion admission file required');
  const policy = validateIngestionAdmission(JSON.parse(readFileSync(policyFile, 'utf8')));
  const disk = statfsSync(process.cwd());
  if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('Ingestion requires at least 1 GiB free disk space');
  const redis = getBullmqCommandRedis();
  if (redis.status === 'wait') await redis.connect();
  if (!redisPersistenceHealthy(await redis.info('persistence'))) throw new Error('Redis persistence unhealthy; no workers started');
  assertPendingJobsApproved(await pendingIngestionJobs(redis), policy);
  const admin = createSupabaseAdmin();
  add(startIngestPipelineWorker());
  add(startProductResolveWorker(admin));
  add(startProductAiReviewWorker(admin));
  add(startContentSourceProcessingWorker(admin));
  add(startCreatorLibrarySyncWorker(admin));
  await Promise.all(workers.map(w => w.waitUntilReady()));
  if (closing) return;
  logger.info({ queues: workers.map(w => w.name) }, 'ingestion.runtime.ready');
  watchdog = setInterval(() => {
    const stopped = stoppedWorkers(workers);
    if (stopped.length) {
      logger.error({ queues: stopped }, 'ingestion.runtime.consumer_stopped');
      void shutdown(1);
    }
  }, 5000);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
void main().catch(error => {
  logger.error({ message: error instanceof Error ? error.message : 'Startup failed' }, 'ingestion.runtime.startup_failed');
  void shutdown(1);
});
