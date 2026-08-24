import { Queue, Worker } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logger';
import {
  getBullmqConnection,
  REDIS_UNAVAILABLE_ENQUEUE_ERROR,
  resolveRedisAvailability,
  shouldBypassBullmqEnqueue,
  withTimeout,
} from '../../workers/redisConnection';
import { createProductIntelligence } from '../factory';
import { pdpSearchHintsAls } from '../search/pdpSearchHints';
import { createCollectionTagRemap } from '../../collection/factory';
import { createCartItemRemap } from '../../cart/factory';
import { composeCollectionTagRemaps } from '../../catalog/ports';

export const PRODUCT_RESOLVE_QUEUE = 'product-resolve';

export type ProductResolveJobData = {
  draftId: string;
  ingestId: string;
  videoProductId?: string;
  traceId?: string;
};

let resolveQueue: Queue<ProductResolveJobData> | null = null;

export function getProductResolveQueue(): Queue<ProductResolveJobData> {
  if (resolveQueue) return resolveQueue;
  resolveQueue = new Queue<ProductResolveJobData>(PRODUCT_RESOLVE_QUEUE, {
    connection: getBullmqConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 8000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return resolveQueue;
}

export async function enqueueProductResolve(data: ProductResolveJobData): Promise<void> {
  const available = await resolveRedisAvailability();
  if (shouldBypassBullmqEnqueue(available)) {
    throw new Error(REDIS_UNAVAILABLE_ENQUEUE_ERROR);
  }
  const q = getProductResolveQueue();
  // One job per draft — background enrichment updates catalog in place.
  await withTimeout(
    q.add('resolve', data, {
      jobId: `resolve-${data.draftId}`,
    }),
    5_000,
    'product.resolve.enqueue',
  );
}

async function syncVideoProductFromCatalog(
  admin: SupabaseClient,
  videoProductId: string,
  catalogProductId: string,
  resolutionStatus: string,
  merchantUrl: string | null,
  affiliateUrl: string | null,
): Promise<void> {
  const { data: cat } = await admin
    .from('catalog_products')
    .select('name, price, image_url, merchant, merchant_url, affiliate_url, currency')
    .eq('id', catalogProductId)
    .maybeSingle();
  if (!cat) {
    await admin
      .from('video_products')
      .update({
        catalog_product_id: catalogProductId,
        merchant_url: merchantUrl,
        affiliate_url: affiliateUrl ?? undefined,
        resolution_status: resolutionStatus,
      })
      .eq('id', videoProductId);
    return;
  }
  await admin
    .from('video_products')
    .update({
      catalog_product_id: catalogProductId,
      name: cat.name,
      price: cat.price ?? '—',
      image: cat.image_url,
      provider: cat.merchant ?? 'catalog',
      merchant_url: cat.merchant_url ?? merchantUrl,
      affiliate_url: cat.affiliate_url ?? affiliateUrl ?? null,
      resolution_status: resolutionStatus,
    })
    .eq('id', videoProductId);
}

export function startProductResolveWorker(admin: SupabaseClient): Worker<ProductResolveJobData> {
  const worker = new Worker<ProductResolveJobData>(
    PRODUCT_RESOLVE_QUEUE,
    async (job) => {
      const { draftId, ingestId, videoProductId } = job.data;
      logger.info({ draftId, ingestId, videoProductId }, 'product.resolve.job.start');

      const { data: draft } = await admin
        .from('ingest_draft_products')
        .select(
          'id, external_id, name, brand, model, category, confidence, merchant_url, image, price, currency, catalog_product_id, resolution_status, sources, evidence',
        )
        .eq('id', draftId)
        .maybeSingle();
      if (!draft) {
        logger.warn({ draftId }, 'product.resolve.draft_missing');
        return;
      }

      // Already fully verified with catalog — skip duplicate work.
      if (
        draft.resolution_status === 'VERIFIED' &&
        draft.catalog_product_id &&
        draft.merchant_url
      ) {
        if (videoProductId) {
          await syncVideoProductFromCatalog(
            admin,
            videoProductId,
            String(draft.catalog_product_id),
            'VERIFIED',
            (draft.merchant_url as string) ?? null,
            null,
          );
        }
        logger.info({ draftId, result: 'already_verified' }, 'product.resolve.job.done');
        return;
      }

      const pi = createProductIntelligence(
        admin,
        ingestId,
        {
          async enqueue(j) {
            await enqueueProductResolve(j);
          },
        },
        job.data.traceId ?? ingestId,
        composeCollectionTagRemaps(
          createCollectionTagRemap(admin),
          createCartItemRemap(admin),
        ),
      );
      if (!pi) return;
      const { data: ingest } = await admin
        .from('ingest_requests')
        .select('video_title')
        .eq('id', ingestId)
        .maybeSingle();

      const results = await pdpSearchHintsAls.run(
        {
          brand: (draft.brand as string) ?? null,
          name: String(draft.name),
          category: (draft.category as string) ?? null,
        },
        () =>
          pi.resolver.resolveIngest([
            {
              draftId: String(draft.id),
              externalId: String(draft.external_id),
              name: String(draft.name),
              brand: (draft.brand as string) ?? null,
              model: (draft.model as string) ?? null,
              category: (draft.category as string) ?? null,
              confidence: Number(draft.confidence) || 0.5,
              merchantUrl: (draft.merchant_url as string) ?? null,
              image: (draft.image as string) ?? null,
              price: (draft.price as string) ?? null,
              currency: (draft.currency as string) ?? null,
              catalogProductId: (draft.catalog_product_id as string) ?? null,
              sources: Array.isArray(draft.sources) ? (draft.sources as string[]) : [],
              evidence:
                draft.evidence && typeof draft.evidence === 'object'
                  ? (draft.evidence as Record<string, unknown>)
                  : null,
              videoTitle: (ingest?.video_title as string) ?? null,
            },
          ]),
      );

      const r = results[0];
      if (r?.catalogProductId && videoProductId) {
        await syncVideoProductFromCatalog(
          admin,
          videoProductId,
          r.catalogProductId,
          r.resolutionStatus,
          r.merchantUrl,
          r.affiliateUrl,
        );
      }
      logger.info({ draftId, result: r?.decision }, 'product.resolve.job.done');
    },
    { connection: getBullmqConnection().duplicate(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'product.resolve.job.failed');
  });
  return worker;
}
