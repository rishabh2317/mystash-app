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
 * Persist ranked AI draft products from extraction.
 * merchant_url = destination hint (optional); affiliate_url left empty until Product Intelligence.
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
      p.merchantUrl && p.merchantUrl.startsWith('http') && !p.merchantUrl.includes('google.com/search')
        ? p.merchantUrl
        : null;
    const ev = evidenceJson(p);
    draftRows.push({
      ingest_request_id: params.ingestId,
      external_id: p.externalId ?? `p_${i}`,
      name: p.name,
      price: p.price ?? '—',
      currency: p.currency ?? null,
      image: p.image ?? null,
      merchant_url: merchantUrl,
      affiliate_url: '',
      provider: 'ai_extract',
      confidence: p.confidence,
      ai_confidence: p.confidence,
      category: p.category ?? null,
      brand: p.brand,
      model: p.model,
      sources: p.sources ?? [],
      evidence: ev,
      sort_order: p.sortOrder ?? i,
      frame_refs: ev.frames ?? [],
      resolution_status: 'UNRESOLVED',
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
      productIntelligencePending: true,
    },
  });

  const update: Record<string, unknown> = {
    // Review must not observe pre-resolution rows and then swap their catalog
    // identity/images underneath mounted cards. Orchestrator publishes the
    // final status after synchronous Product Intelligence completes.
    status: 'processing',
    updated_at: new Date().toISOString(),
  };
  if (params.thumbnail) update.thumbnail = params.thumbnail;
  if (params.videoTitle) update.video_title = params.videoTitle;

  await admin.from('ingest_requests').update(update).eq('id', params.ingestId);
}
