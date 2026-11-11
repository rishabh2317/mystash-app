import {resolveCountryCode} from '../../merchant-pricing/country';
import { ImportWorkBusyError } from '../../user-import/workContext';
import { startShareRecovery } from '../../user-import/share/recovery';
import { DelayedError, Worker, type Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logger';
import { createResolvingContentSourceProcessor } from '../processing/createResolvingProcessor';
import { ContentSourceResolutionService } from '../processing/ContentSourceResolutionService';
import { createCartService } from '../../cart/factory';
import { createDiscoveredProductService } from '../../discovered/factory';
import { createProductIntelligence } from '../../product-intelligence/factory';
import { SupabaseUserImportRepository } from '../../user-import/SupabaseUserImportRepository';
import { SupabaseUserRepository } from '../../user/SupabaseUserRepository';
import { SupabaseContentSourceRepository } from '../SupabaseContentSourceRepository';
import { duplicateBullmqWorkerRedis } from '../../workers/redisConnection';
import { withFreeTestExtractionSlot } from '../../workers/freeTestBudget';
import {
  CONTENT_SOURCE_QUEUE,
  type ContentSourceEnrichmentJobData,
  type ContentSourceProcessingJobData,
  type ContentSourceQueueJobData,
} from './contentSourceQueue';

/** Retain the embedded worker so the consume loop is not eligible for GC. */
let contentSourceWorker: Worker<ContentSourceQueueJobData> | null = null;

function createEnrichmentService(admin: SupabaseClient): ContentSourceResolutionService | null {
  const sources = new SupabaseContentSourceRepository(admin);
  const userImports = new SupabaseUserImportRepository(admin);
  const users = new SupabaseUserRepository(admin);
  const pi = createProductIntelligence(admin, 'content-source', null, 'content-source');
  if (!pi) return null;
  return new ContentSourceResolutionService(
    sources,
    createDiscoveredProductService(admin),
    {
      resolveForUserImport: (drafts) => pi.resolver.resolveForUserImport(drafts),
      getCatalogProduct: (id) => pi.catalog.getById(id),
    },
    userImports,
    createCartService(admin),
    {
      async getCommerceCountry(userId) {
        const user = await users.getById(userId);
        return resolveCountryCode({profile:user?.country,deviceLocale:typeof user?.extensions?.shoppingLocale==='string'?user.extensions.shoppingLocale:user?.language});
      },
    },
  );
}

/**
 * Worker: process = extract + fast Bag path; enrich = background merchant offers;
 * user-import-timeout = drain historical presentation timers.
 */
export function startContentSourceProcessingWorker(
  admin: SupabaseClient,
): Worker<ContentSourceQueueJobData> {
  if (contentSourceWorker && !contentSourceWorker.closing) {
    logger.info({ queue: CONTENT_SOURCE_QUEUE }, 'content_source.worker.already_running');
    return contentSourceWorker;
  }

  const processor = createResolvingContentSourceProcessor(admin);
  const enrichment = createEnrichmentService(admin);
  const connection = duplicateBullmqWorkerRedis('content-source-worker');
  logger.info(
    {
      queue: CONTENT_SOURCE_QUEUE,
      host: connection.options.host,
      port: connection.options.port,
    },
    'content_source.worker.created',
  );

  const worker = new Worker<ContentSourceQueueJobData>(
    CONTENT_SOURCE_QUEUE,
    async (job: Job<ContentSourceQueueJobData>) => {
      if (job.name === 'user-import-timeout') {
        // Drain historical presentation timers without freezing a find or cancelling active work.
        return;
      }

      if (job.name === 'enrich') {
        const data = job.data as ContentSourceEnrichmentJobData;
        logger.info(
          {
            contentSourceId: data.contentSourceId,
            discoveredProductId: data.discoveredProductId,
            jobId: job.id,
          },
          'content_source.enrich.start',
        );
        if (!enrichment) {
          logger.warn('content_source.enrich.skipped_no_pi');
          return;
        }
        await enrichment.enrichDiscoveredProduct({
          contentSourceId: data.contentSourceId,
          contentSourceProductId: data.contentSourceProductId,
          discoveredProductId: data.discoveredProductId,
          userImportId: data.userImportId,
        });
        logger.info(
          { discoveredProductId: data.discoveredProductId, jobId: job.id },
          'content_source.enrich.done',
        );
        return;
      }

      const data = job.data as ContentSourceProcessingJobData;
      const { contentSourceId, userImportId, traceId } = data;
      logger.info(
        { contentSourceId, userImportId, traceId, jobId: job.id },
        'content_source.job.start',
      );
      try {
        await withFreeTestExtractionSlot(() => processor.process(data,
          { attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts ?? 3 }));
      } catch (err) {
        if (!(err instanceof ImportWorkBusyError)) throw err;
        await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
        throw new DelayedError();
      }
      logger.info({ contentSourceId, jobId: job.id }, 'content_source.job.done');
    },
    { connection, concurrency: 2 },
  );

  const stopShareRecovery = startShareRecovery(admin, () => Boolean(worker.closing));
  worker.on('closed', stopShareRecovery);
  worker.on('ready', () => {
    logger.info(
      { queue: CONTENT_SOURCE_QUEUE, running: worker.isRunning() },
      'content_source.worker.ready',
    );
  });
  worker.on('active', (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'content_source.job.active');
  });
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'content_source.job.completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'content_source.job.failed');
  });
  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'content_source.job.stalled');
  });
  worker.on('error', (err) => {
    logger.error({ err }, 'content_source.worker.error');
  });

  void worker.waitUntilReady().then(
    () =>
      logger.info(
        { queue: CONTENT_SOURCE_QUEUE, running: worker.isRunning() },
        'content_source.worker.redis_ready',
      ),
    (err) => logger.warn({ err }, 'content_source.worker.redis_not_ready'),
  );

  contentSourceWorker = worker;
  return worker;
}
