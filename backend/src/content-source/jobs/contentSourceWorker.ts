import { Worker } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logger';
import { createResolvingContentSourceProcessor } from '../processing/createResolvingProcessor';
import { getBullmqCommandRedis } from '../../workers/redisConnection';
import {
  CONTENT_SOURCE_QUEUE,
  type ContentSourceProcessingJobData,
} from './jobIdentity';

/**
 * Worker: delegates to ContentSourceProcessor. Resolution and Bag writes stay out of
 * this file — they are wired inside the resolving processor factory.
 */
export function startContentSourceProcessingWorker(
  admin: SupabaseClient,
): Worker<ContentSourceProcessingJobData> {
  const processor = createResolvingContentSourceProcessor(admin);
  const worker = new Worker<ContentSourceProcessingJobData>(
    CONTENT_SOURCE_QUEUE,
    async (job) => {
      const { contentSourceId, userImportId, traceId } = job.data;
      logger.info(
        { contentSourceId, userImportId, traceId, jobId: job.id },
        'content_source.job.start',
      );
      await processor.process(job.data, {
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
      });
    },
    { connection: getBullmqCommandRedis().duplicate(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'content_source.job.failed');
  });

  void worker.waitUntilReady().then(
    () => logger.info('content_source.worker.redis_ready'),
    (err) => logger.warn({ err }, 'content_source.worker.redis_not_ready'),
  );

  return worker;
}
