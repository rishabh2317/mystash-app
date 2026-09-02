import { Queue, Worker } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCatalogService } from '../../catalog/factory';
import { logger } from '../../logger';
import {
  getBullmqConnection,
  REDIS_UNAVAILABLE_ENQUEUE_ERROR,
  resolveRedisAvailability,
  shouldBypassBullmqEnqueue,
  withTimeout,
} from '../../workers/redisConnection';
import { createGeminiAiReviewGenerator } from '../GeminiAiReviewGenerator';
import { ProductAiReviewService } from '../ProductAiReviewService';
import { SupabaseProductAiReviewRepository } from '../SupabaseProductAiReviewRepository';

export const PRODUCT_AI_REVIEW_QUEUE = 'product-ai-review';

export type ProductAiReviewJobData = {
  productId: string;
  evidenceHash: string;
  refresh?: boolean;
  traceId?: string;
};

let reviewQueue: Queue<ProductAiReviewJobData> | null = null;

export function getProductAiReviewQueue(): Queue<ProductAiReviewJobData> {
  if (reviewQueue) return reviewQueue;
  reviewQueue = new Queue<ProductAiReviewJobData>(PRODUCT_AI_REVIEW_QUEUE, {
    connection: getBullmqConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return reviewQueue;
}

export async function enqueueProductAiReview(data: ProductAiReviewJobData): Promise<void> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    throw new Error(REDIS_UNAVAILABLE_ENQUEUE_ERROR);
  }
  const q = getProductAiReviewQueue();
  await withTimeout(
    q.add('generate', data, { jobId: `ai-review-${data.productId}` }),
    5_000,
    'ai_review.enqueue',
  );
}

export function createProductAiReviewService(admin: SupabaseClient): ProductAiReviewService {
  const catalog = createCatalogService(admin);
  const repo = new SupabaseProductAiReviewRepository(admin);
  const generator = createGeminiAiReviewGenerator();

  const enqueue = async (productId: string, evidenceHash: string, options?: { refresh?: boolean }) => {
    try {
      await enqueueProductAiReview({ productId, evidenceHash, refresh: options?.refresh });
    } catch (e) {
      if ((e as Error).message === REDIS_UNAVAILABLE_ENQUEUE_ERROR) {
        const svc = new ProductAiReviewService(catalog, repo, generator, async () => undefined);
        void svc
          .runGeneration(productId, evidenceHash, { refresh: options?.refresh })
          .catch((err: unknown) => {
          logger.error({ productId, err }, 'ai_review.inline_generation.failed');
        });
        return;
      }
      throw e;
    }
  };

  return new ProductAiReviewService(catalog, repo, generator, enqueue);
}

export function startProductAiReviewWorker(admin: SupabaseClient): Worker<ProductAiReviewJobData> {
  const svc = createProductAiReviewService(admin);
  const worker = new Worker<ProductAiReviewJobData>(
    PRODUCT_AI_REVIEW_QUEUE,
    async (job) => {
      logger.info(
        { productId: job.data.productId, jobId: job.id },
        'ai_review.job.start',
      );
      await svc.runGeneration(job.data.productId, job.data.evidenceHash, {
        refresh: job.data.refresh,
      });
      logger.info({ productId: job.data.productId }, 'ai_review.job.done');
    },
    { connection: getBullmqConnection().duplicate(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ai_review.job.failed');
  });
  return worker;
}
