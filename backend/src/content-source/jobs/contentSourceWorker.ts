import { Worker, type Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logger';
import { createResolvingContentSourceProcessor } from '../processing/createResolvingProcessor';
import { ContentSourceResolutionService } from '../processing/ContentSourceResolutionService';
import { createCartService } from '../../cart/factory';
import { createDiscoveredProductService } from '../../discovered/factory';
import { createProductIntelligence } from '../../product-intelligence/factory';
import { shareProgressState } from '../../user-import/domain/shareProgress';
import { SupabaseUserImportRepository } from '../../user-import/SupabaseUserImportRepository';
import { SupabaseUserRepository } from '../../user/SupabaseUserRepository';
import { SupabaseContentSourceRepository } from '../SupabaseContentSourceRepository';
import { duplicateBullmqWorkerRedis } from '../../workers/redisConnection';
import {
  CONTENT_SOURCE_QUEUE,
  type ContentSourceEnrichmentJobData,
  type ContentSourceProcessingJobData,
  type ContentSourceQueueJobData,
  type UserImportTimeoutJobData,
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
      resolveForUserImportFast: (drafts) => pi.resolver.resolveForUserImportFast(drafts),
    },
    userImports,
    createCartService(admin),
    {
      async getCommerceCountry(userId) {
        const user = await users.getById(userId);
        return user?.country ?? null;
      },
    },
  );
}

/**
 * Worker: process = extract + fast Bag path; enrich = background merchant offers;
 * user-import-timeout = freeze LOOKING imports after 10 minutes.
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
  const userImports = new SupabaseUserImportRepository(admin);
  const sources = new SupabaseContentSourceRepository(admin);
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
        const data = job.data as UserImportTimeoutJobData;
        logger.info({ userImportId: data.userImportId, jobId: job.id }, 'user_import.timeout.start');
        const row = await userImports.findById(data.userImportId);
        if (!row) {
          logger.info({ userImportId: data.userImportId }, 'user_import.timeout.missing');
          return;
        }
        if (row.timedOutAt) {
          logger.info({ userImportId: data.userImportId }, 'user_import.timeout.already');
          return;
        }
        const source = row.contentSourceId
          ? await sources.findById(row.contentSourceId)
          : null;
        const state = shareProgressState(source);
        if (state !== 'looking') {
          logger.info(
            { userImportId: data.userImportId, state },
            'user_import.timeout.skip_terminal',
          );
          return;
        }
        await userImports.markTimedOut(row.id, new Date().toISOString());
        logger.info({ userImportId: data.userImportId }, 'user_import.timeout.applied');
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
      await processor.process(data, {
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
      });
      logger.info({ contentSourceId, jobId: job.id }, 'content_source.job.done');
    },
    { connection, concurrency: 2 },
  );

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
