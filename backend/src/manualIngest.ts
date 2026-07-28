import type { SupabaseClient } from '@supabase/supabase-js';
import { wrapAffiliateDestination } from './pipeline/affiliate';
import { detectPlatform, extractYouTubeVideoId } from './pipeline/detect';
import { ingestLog } from './pipeline/ingestLog';
import { previewProductLink } from './pipeline/productLinkPreview';

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
  affiliate_url: string;
  provider: string | null;
  confidence: number | null;
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

  const previews = await Promise.all(
    productUrls.map((u) => previewProductLink(admin, u, { ingestId, traceId })),
  );

  for (let i = 0; i < previews.length; i++) {
    const preview = previews[i]!;
    const wrapped = await wrapAffiliateDestination(preview.merchantUrl, {
      ingestId,
      traceId,
      index: i,
    });

    const provider = wrapped.provider === 'fallback' ? 'manual' : wrapped.provider;

    draftRows.push({
      ingest_request_id: ingestId,
      external_id: preview.externalId,
      name: preview.name,
      price: preview.price,
      currency: preview.currency ?? null,
      image: preview.image ?? null,
      affiliate_url: wrapped.affiliateUrl,
      provider,
      confidence: 1,
    });

    apiProducts.push({
      id: preview.externalId,
      name: preview.name,
      price: preview.price,
      currency: preview.currency,
      provider,
      affiliateUrl: wrapped.affiliateUrl,
      image: preview.image,
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
