import type { SupabaseClient } from '@supabase/supabase-js';
import { detectPlatform, extractYouTubeVideoId } from './pipeline/detect';
import { ingestLog } from './pipeline/ingestLog';
import { externalIdForProductUrl } from './pipeline/productLinkPreview';
import { MerchantEnrichmentService } from './product-intelligence/enrichment/MerchantEnrichmentService';
import { TavilyMerchantExtractor } from './product-intelligence/enrichment/TavilyMerchantExtractor';
import { resolveIngestDrafts } from './product-intelligence';

const PIPELINE_VERSION = 'manual_v1';

async function fetchYouTubeTitle(sourceUrl: string): Promise<string | undefined> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { title?: string };
    return typeof j.title === 'string' ? j.title : undefined;
  } catch {
    return undefined;
  }
}

async function fetchInstagramTitle(sourceUrl: string): Promise<string | undefined> {
  try {
    const r = await fetch(`https://api.instagram.com/oembed/?url=${encodeURIComponent(sourceUrl)}`);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { title?: string };
    return typeof j.title === 'string' ? j.title : undefined;
  } catch {
    return undefined;
  }
}

export type ManualIngestProductRow = {
  ingest_request_id: string;
  external_id: string;
  name: string;
  price: string;
  currency: string | null;
  image: string | null;
  merchant_url: string | null;
  affiliate_url: string;
  provider: string | null;
  confidence: number | null;
  ai_confidence?: number | null;
  resolution_status?: string | null;
};

export type ManualIngestApiProduct = {
  id: string;
  name: string;
  price: string;
  currency?: string;
  provider: string;
  affiliateUrl: string;
  image?: string;
  confidence?: number;
};

export async function createManualIngest(
  admin: SupabaseClient,
  params: {
    userId: string;
    sourceUrl: string;
    productUrls: string[];
    traceId: string;
    /** When set, stored on `ingest_requests.video_title` instead of oEmbed title. */
    videoTitleFromClient?: string;
  },
): Promise<{
  ingestId: string;
  sourceUrl: string;
  platform: string;
  videoTitle: string;
  thumbnail?: string;
  stashScore: number;
  products: ManualIngestApiProduct[];
  status: string;
  extractionPending: boolean;
  extractionSource: string;
  extractionDurationMs: number;
  traceId: string;
  extractionStatus: string;
  extractionError: null;
  pipelineMeta: Record<string, unknown> | null;
}> {
  const { userId, sourceUrl, productUrls, traceId, videoTitleFromClient } = params;

  const platform = detectPlatform(sourceUrl);
  if (platform === 'unknown') {
    throw new Error('Only YouTube and Instagram video URLs are supported');
  }

  const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
  const thumbnail =
    platform === 'youtube' && ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;

  const customTitle = videoTitleFromClient?.trim();
  let videoTitle = platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel';
  if (customTitle) {
    videoTitle = customTitle.slice(0, 200);
  } else if (platform === 'youtube') {
    const t = await fetchYouTubeTitle(sourceUrl);
    if (t) videoTitle = t;
  } else {
    const t = await fetchInstagramTitle(sourceUrl);
    if (t) videoTitle = t;
  }

  const { data: ingestRow, error: insErr } = await admin
    .from('ingest_requests')
    .insert({
      user_id: userId,
      source_url: sourceUrl,
      platform,
      status: 'draft',
      stash_score: 4.5,
      video_title: videoTitle,
      thumbnail,
    })
    .select('id')
    .single();

  if (insErr || !ingestRow) {
    throw new Error(insErr?.message ?? 'Could not create ingest request');
  }

  const ingestId = ingestRow.id as string;

  const draftRows: ManualIngestProductRow[] = [];
  const apiProducts: ManualIngestApiProduct[] = [];

  const enrichment = new MerchantEnrichmentService(new TavilyMerchantExtractor(admin));
  const enrichResults = await Promise.all(
    productUrls.map((u) =>
      enrichment.enrich({
        merchantUrl: u,
        ingestId,
        traceId,
      }),
    ),
  );

  for (let i = 0; i < enrichResults.length; i++) {
    const result = enrichResults[i]!;
    if (result.kind === 'failed') {
      ingestLog('warn', 'manual.enrichment_failed', {
        ingestId,
        message: result.message,
        url: productUrls[i]?.slice(0, 120),
      });
      continue;
    }
    const preview = result.metadata;

    draftRows.push({
      ingest_request_id: ingestId,
      external_id: externalIdForProductUrl(preview.merchantUrl),
      name: preview.title,
      price: preview.price ?? '—',
      currency: preview.currency ?? null,
      image: preview.image ?? null,
      merchant_url: preview.merchantUrl,
      affiliate_url: '',
      provider: preview.merchant || 'manual',
      confidence: 1,
      ai_confidence: 1,
      resolution_status: 'UNRESOLVED',
    });

    apiProducts.push({
      id: draftRows[draftRows.length - 1]!.external_id,
      name: preview.title,
      price: preview.price ?? '—',
      currency: preview.currency ?? undefined,
      provider: preview.merchant || 'manual',
      affiliateUrl: '',
      image: preview.image ?? undefined,
      confidence: 1,
    });
  }

  if (draftRows.length > 0) {
    const { error: insErr } = await admin.from('ingest_draft_products').insert(draftRows);
    if (insErr) {
      ingestLog('error', 'manual.draft_products_insert_failed', {
        ingestId,
        message: insErr.message,
        code: insErr.code,
      });
      throw new Error(`Could not save draft products: ${insErr.message}`);
    }
  }

  try {
    await resolveIngestDrafts(admin, ingestId);
    const { data: resolved } = await admin
      .from('ingest_draft_products')
      .select('external_id, name, price, currency, image, affiliate_url, provider, confidence')
      .eq('ingest_request_id', ingestId);
    if (resolved?.length) {
      apiProducts.length = 0;
      for (const r of resolved) {
        apiProducts.push({
          id: String(r.external_id),
          name: String(r.name),
          price: String(r.price),
          currency: (r.currency as string) ?? undefined,
          provider: String(r.provider ?? 'manual'),
          affiliateUrl: String(r.affiliate_url ?? ''),
          image: (r.image as string) ?? undefined,
          confidence: Number(r.confidence) || 1,
        });
      }
    }
  } catch (e) {
    ingestLog('warn', 'manual.product_intelligence_failed', {
      ingestId,
      message: (e as Error).message?.slice(0, 160),
    });
  }

  await admin.from('ingest_extractions').insert({
    ingest_request_id: ingestId,
    payload: {
      model: 'manualProductLinks',
      count: draftRows.length,
      extractionSource: 'manual',
      extractionStatus: 'ok',
      extractionError: null,
      pipelineMeta: {
        priceAgent: 'link_preview',
        contextSources: ['og_meta', 'json_ld'],
        productIntelligence: true,
      },
      durationMs: 0,
      traceId,
      pipelineVersion: PIPELINE_VERSION,
    },
  });

  return {
    ingestId,
    sourceUrl,
    platform,
    videoTitle,
    thumbnail: thumbnail ?? undefined,
    stashScore: 4.5,
    products: apiProducts,
    status: 'draft',
    extractionPending: false,
    extractionSource: 'manual',
    extractionDurationMs: 0,
    traceId,
    extractionStatus: 'ok',
    extractionError: null,
    pipelineMeta: {
      transcriptAgent: 'not_applicable',
      contextSources: ['manual_links'],
      priceAgent: 'link_preview',
    },
  };
}
