import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductCandidate, ProductEvidence } from '../domain/types';
import { ingestLog } from '../pipeline/ingestLog';

function evidenceJson(p: ProductCandidate): ProductEvidence {
  if (typeof p.evidence === 'string') {
    return {
      summary: p.evidence,
      frames: [],
      frameCount: 0,
      logoHits: [],
      transcriptMentions: false,
      ocrMentions: false,
    };
  }
  return p.evidence;
}

/**
 * Persist ranked canonical products from extraction.
 * Does NOT wrap affiliate links — that happens after catalog match + review (publish).
 * `affiliate_url` column stores the destination / merchant URL until post-review wrapping.
 */
export async function persistPipelineProducts(
  admin: SupabaseClient,
  params: {
    ingestId: string;
    traceId: string;
    products: ProductCandidate[];
    status: 'ready_for_review' | 'review_required';
    pipelineMeta: Record<string, unknown>;
    thumbnail?: string | null;
    videoTitle?: string;
  },
): Promise<void> {
  const draftRows: Record<string, unknown>[] = [];

  for (let i = 0; i < params.products.length; i++) {
    const p = params.products[i]!;
    const merchantUrl =
      p.merchantUrl && p.merchantUrl.startsWith('http')
        ? p.merchantUrl
        : `https://www.google.com/search?q=${encodeURIComponent(p.name)}`;
    const ev = evidenceJson(p);
    draftRows.push({
      ingest_request_id: params.ingestId,
      external_id: p.externalId ?? `p_${i}`,
      name: p.name,
      price: p.price ?? '—',
      currency: p.currency ?? null,
      image: p.image ?? null,
      affiliate_url: merchantUrl,
      provider: 'canonical',
      confidence: p.confidence,
      category: p.category ?? null,
      brand: p.brand,
      model: p.model,
      sources: p.sources ?? [],
      evidence: ev,
      sort_order: p.sortOrder ?? i,
      frame_refs: ev.frames ?? [],
    });
  }

  if (draftRows.length > 0) {
    const { error } = await admin.from('ingest_draft_products').insert(draftRows);
    if (error) {
      ingestLog('error', 'persist.draft_products_insert_failed', {
        ingestId: params.ingestId,
        message: error.message,
      });
      throw new Error(`Could not save draft products: ${error.message}`);
    }
  }

  await admin.from('ingest_extractions').insert({
    ingest_request_id: params.ingestId,
    payload: {
      model: 'progressiveMultimodal',
      count: draftRows.length,
      extractionSource: 'openai',
      extractionStatus: params.status === 'ready_for_review' ? 'ok' : 'degraded',
      extractionError:
        params.status === 'review_required'
          ? {
              code: 'REVIEW_REQUIRED',
              message: 'No confident products found. Add products manually or retry.',
            }
          : null,
      pipelineMeta: params.pipelineMeta,
      durationMs: 0,
      traceId: params.traceId,
      affiliateDeferred: true,
    },
  });

  const update: Record<string, unknown> = {
    status: params.status,
    updated_at: new Date().toISOString(),
  };
  if (params.thumbnail) update.thumbnail = params.thumbnail;
  if (params.videoTitle) update.video_title = params.videoTitle;

  await admin.from('ingest_requests').update(update).eq('id', params.ingestId);
}
