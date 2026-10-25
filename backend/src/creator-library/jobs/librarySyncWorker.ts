import { Worker } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logger';
import { getNotificationEmitter, librarySyncFailedEvent } from '../../notifications/producers';
import { getBullmqConnection } from '../../workers/redisConnection';
import { createCreatorLibraryService } from '../CreatorLibraryService';
import { SupabaseCreatorLibraryRepository } from '../SupabaseCreatorLibraryRepository';
import {
  CREATOR_LIBRARY_SYNC_QUEUE,
  type CreatorLibrarySyncJobData,
} from './librarySyncQueue';

export function startCreatorLibrarySyncWorker(admin: SupabaseClient): Worker<CreatorLibrarySyncJobData> {
  const worker = new Worker<CreatorLibrarySyncJobData>(
    CREATOR_LIBRARY_SYNC_QUEUE,
    async (job) => {
      const service = createCreatorLibraryService(admin);
      try {
        await service.runSyncJob(job.data);
      } catch (e) {
        const attempts = job.opts.attempts ?? 1;
        if (job.attemptsMade + 1 >= attempts) {
          const message = e instanceof Error ? e.message.slice(0, 240) : 'Sync failed';
          await new SupabaseCreatorLibraryRepository(admin).setSyncState(job.data.connectedAccountId, {
            status: 'failed',
            error: message,
          });
          await getNotificationEmitter().emitSafely(
            librarySyncFailedEvent({
              connectedAccountId: job.data.connectedAccountId,
              userId: job.data.userId,
              runStartedAt: job.data.runStartedAt,
              failedAt: new Date().toISOString(),
              provider: 'youtube',
            }),
          );
        }
        throw e;
      }
    },
    { connection: getBullmqConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    logger.warn(
      { jobId: job?.id, message: err.message.slice(0, 240) },
      'creator library sync failed',
    );
  });
  return worker;
}
