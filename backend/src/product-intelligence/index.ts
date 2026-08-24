export { createProductIntelligence } from './factory';
export type { ProductIntelligenceBundle } from './factory';
export { enqueueProductResolve, startProductResolveWorker } from './jobs/productResolveQueue';
export { ProductNormalizer } from './normalizer/ProductNormalizer';
export type { AiDraftInput, ResolveDraftResult } from './domain/types';
import { pdpSearchHintsAls } from './search/pdpSearchHints';
import { ingestDraftNeedsProductResolve } from './ingestDraftResolveGate';

export { ingestDraftNeedsProductResolve } from './ingestDraftResolveGate';

/** Run ProductResolver for all drafts on an ingest (post-extract hook). */
export async function resolveIngestDrafts(
  admin: import('@supabase/supabase-js').SupabaseClient,
  ingestId: string,
  traceId: string = ingestId,
  opts?: { creatorSuppliedUrl?: boolean; onlyUnresolved?: boolean },
): Promise<void> {
  const { createProductIntelligence: create } = await import('./factory');
  const { enqueueProductResolve } = await import('./jobs/productResolveQueue');

  const pi = create(
    admin,
    ingestId,
    {
      async enqueue(job) {
        try {
          await enqueueProductResolve(job);
        } catch (err) {
          if ((err as Error).message === 'ingest.queue.redis_unavailable') return;
          throw err;
        }
      },
    },
    traceId,
  );
  if (!pi) return;

  const { data: ingest } = await admin
    .from('ingest_requests')
    .select('video_title')
    .eq('id', ingestId)
    .maybeSingle();
  const { data: rows } = await admin
    .from('ingest_draft_products')
    .select(
      'id, external_id, name, brand, model, category, confidence, merchant_url, image, price, currency, catalog_product_id, resolution_status, sources, evidence, provider',
    )
    .eq('ingest_request_id', ingestId);

  if (!rows?.length) return;

  for (const d of rows) {
    if (
      opts?.onlyUnresolved &&
      !ingestDraftNeedsProductResolve({
        catalogProductId: (d.catalog_product_id as string) ?? null,
        resolutionStatus: (d.resolution_status as string) ?? null,
      })
    ) {
      continue;
    }
    const draft = {
      draftId: String(d.id),
      externalId: String(d.external_id),
      name: String(d.name),
      brand: (d.brand as string) ?? null,
      model: (d.model as string) ?? null,
      category: (d.category as string) ?? null,
      confidence: Number(d.confidence) || 0.5,
      merchantUrl: (d.merchant_url as string) ?? null,
      image: (d.image as string) ?? null,
      price: (d.price as string) ?? null,
      currency: (d.currency as string) ?? null,
      catalogProductId: (d.catalog_product_id as string) ?? null,
      sources: Array.isArray(d.sources) ? (d.sources as string[]) : [],
      evidence:
        d.evidence && typeof d.evidence === 'object'
          ? (d.evidence as Record<string, unknown>)
          : null,
      videoTitle: (ingest?.video_title as string) ?? null,
      creatorSuppliedUrl:
        opts?.creatorSuppliedUrl === true || (d.provider as string | null) === 'manual',
    };
    await pdpSearchHintsAls.run(
      { brand: draft.brand, name: draft.name, category: draft.category },
      () => pi.resolver.resolveIngest([draft]),
    );
  }
}
