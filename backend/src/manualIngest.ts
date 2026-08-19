import type { SupabaseClient } from '@supabase/supabase-js';
import { extractYouTubeVideoId } from './pipeline/detect';
import { ingestLog } from './pipeline/ingestLog';
import { parseSupportedVideoUrl, unsupportedVideoUrlMessage } from './pipeline/sourceIdentity';
import { externalIdForProductUrl } from './pipeline/productLinkPreview';
import { MerchantEnrichmentService } from './product-intelligence/enrichment/MerchantEnrichmentService';
import { TavilyMerchantExtractor } from './product-intelligence/enrichment/TavilyMerchantExtractor';
import { resolveIngestDrafts } from './product-intelligence';
import { ingestDraftNeedsProductResolve } from './product-intelligence/ingestDraftResolveGate';

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
  merchantUrl?: string;
  brand?: string | null;
  catalogProductId?: string;
  resolutionStatus?: 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';
};

const TERMINAL_RESOLUTION = new Set(['VERIFIED', 'UNVERIFIED', 'UNRESOLVED']);

export function mapDraftRowToManualApiProduct(r: {
  external_id?: unknown;
  name?: unknown;
  price?: unknown;
  currency?: unknown;
  image?: unknown;
  affiliate_url?: unknown;
  provider?: unknown;
  confidence?: unknown;
  merchant_url?: unknown;
  brand?: unknown;
  catalog_product_id?: unknown;
  resolution_status?: unknown;
}): ManualIngestApiProduct {
  const resolutionRaw = typeof r.resolution_status === 'string' ? r.resolution_status : null;
  const resolutionStatus = resolutionRaw && TERMINAL_RESOLUTION.has(resolutionRaw)
    ? (resolutionRaw as ManualIngestApiProduct['resolutionStatus'])
    : undefined;
  const catalogProductId =
    typeof r.catalog_product_id === 'string' && r.catalog_product_id
      ? r.catalog_product_id
      : undefined;
  const merchantUrl =
    typeof r.merchant_url === 'string' && r.merchant_url.startsWith('http')
      ? r.merchant_url
      : undefined;
  const brand = typeof r.brand === 'string' && r.brand.trim() ? r.brand : undefined;
  return {
    id: String(r.external_id ?? ''),
    name: String(r.name ?? ''),
    price: String(r.price ?? '—'),
    currency: (r.currency as string) ?? undefined,
    provider: String(r.provider ?? 'manual'),
    affiliateUrl: String(r.affiliate_url ?? ''),
    image: (r.image as string) ?? undefined,
    confidence: Number(r.confidence) || 1,
    merchantUrl,
    brand: brand ?? null,
    catalogProductId,
    resolutionStatus,
  };
}

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
  failedProductUrls?: string[];
}> {
  const { userId, sourceUrl, productUrls, traceId, videoTitleFromClient } = params;

  const identity = parseSupportedVideoUrl(sourceUrl);
  if (!identity) {
    throw new Error(unsupportedVideoUrlMessage());
  }
  const platform = identity.platform;
  const canonicalUrl = identity.canonicalUrl;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await admin
    .from('ingest_requests')
    .select('id, status')
    .eq('user_id', userId)
    .in('source_url', [...new Set([canonicalUrl, sourceUrl])])
    .in('status', ['draft', 'processing', 'ready_for_review', 'review_required'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id && existing.status !== 'processing') {
    ingestLog('info', 'manual.duplicate_reuse', { ingestId: existing.id, userId });
    const { data: rows } = await admin
      .from('ingest_draft_products')
      .select('external_id, name, price, currency, image, affiliate_url, provider, confidence')
      .eq('ingest_request_id', existing.id);
    const { data: ir } = await admin
      .from('ingest_requests')
      .select('source_url, platform, video_title, thumbnail, stash_score, status')
      .eq('id', existing.id)
      .maybeSingle();
    return {
      ingestId: existing.id,
      sourceUrl: (ir?.source_url as string) ?? canonicalUrl,
      platform: (ir?.platform as string) ?? platform,
      videoTitle: (ir?.video_title as string) ?? 'Draft',
      thumbnail: (ir?.thumbnail as string) ?? undefined,
      stashScore: Number(ir?.stash_score) || 4.5,
      products: (rows ?? []).map((r) => ({
        id: String(r.external_id),
        name: String(r.name),
        price: String(r.price),
        currency: (r.currency as string) ?? undefined,
        provider: String(r.provider ?? 'manual'),
        affiliateUrl: String(r.affiliate_url ?? ''),
        image: (r.image as string) ?? undefined,
        confidence: Number(r.confidence) || 1,
      })),
      status: String(ir?.status ?? 'ready_for_review'),
      extractionPending: false,
      extractionSource: 'manual',
      extractionDurationMs: 0,
      traceId,
      extractionStatus: 'ok',
      extractionError: null,
      pipelineMeta: { contextSources: ['manual_links'], reused: true },
    };
  }

  const enrichment = new MerchantEnrichmentService(new TavilyMerchantExtractor(admin));
  const enrichResults = await Promise.all(
    productUrls.map((u) =>
      enrichment.enrich({
        merchantUrl: u,
        ingestId: traceId,
        traceId,
        acceptPartialCache: false,
      }),
    ),
  );
  const failedProductUrls: string[] = [];
  type OkMeta = {
    merchantUrl: string;
    title: string;
    price?: string | null;
    currency?: string | null;
    image?: string | null;
    merchant?: string | null;
    brand?: string | null;
  };
  const okMeta: OkMeta[] = [];
  for (let i = 0; i < enrichResults.length; i++) {
    const result = enrichResults[i]!;
    const url = productUrls[i]!;
    if (result.kind === 'failed') {
      ingestLog('warn', 'manual.enrichment_failed', {
        message: result.message,
        url: url.slice(0, 120),
      });
      failedProductUrls.push(url);
      continue;
    }
    okMeta.push(result.metadata);
  }
  if (okMeta.length === 0) {
    throw new Error(
      `Could not extract product details from the provided link${productUrls.length > 1 ? 's' : ''}. Check that each URL is a public product page.`,
    );
  }

  const ytId = platform === 'youtube' ? extractYouTubeVideoId(canonicalUrl) : null;
  const thumbnail =
    platform === 'youtube' && ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;

  const customTitle = videoTitleFromClient?.trim();
  let videoTitle = platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel';
  if (customTitle) {
    videoTitle = customTitle.slice(0, 200);
  } else if (platform === 'youtube') {
    const t = await fetchYouTubeTitle(canonicalUrl);
    if (t) videoTitle = t;
  } else {
    const t = await fetchInstagramTitle(canonicalUrl);
    if (t) videoTitle = t;
  }

  const { data: ingestRow, error: insErr } = await admin
    .from('ingest_requests')
    .insert({
      user_id: userId,
      source_url: canonicalUrl,
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

  const { ensureCollectionForIngest, syncCollectionFromIngestDrafts } = await import(
    './collection/ingestBridge'
  );
  const collectionId = await ensureCollectionForIngest(admin, {
    user: { id: userId },
    ingestId,
    sourceUrl: canonicalUrl,
    platform,
    title: videoTitle,
    thumbnailUrl: thumbnail,
    originType: 'manual_curation',
    qualityScore: 4.5,
    startProcessing: false,
  });

  const draftRows: ManualIngestProductRow[] = [];
  const apiProducts: ManualIngestApiProduct[] = [];

  for (const preview of okMeta) {
    draftRows.push({
      ingest_request_id: ingestId,
      external_id: externalIdForProductUrl(preview.merchantUrl),
      name: preview.title,
      price: preview.price ?? '—',
      currency: preview.currency ?? null,
      image: preview.image ?? null,
      merchant_url: preview.merchantUrl,
      affiliate_url: '',
      provider: 'manual',
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
      merchantUrl: preview.merchantUrl,
      brand: preview.brand ?? null,
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
    await resolveIngestDrafts(admin, ingestId, traceId, { creatorSuppliedUrl: true });
    const { data: resolved } = await admin
      .from('ingest_draft_products')
      .select(
        'external_id, name, price, currency, image, affiliate_url, provider, confidence, merchant_url, brand, catalog_product_id, resolution_status',
      )
      .eq('ingest_request_id', ingestId);
    if (resolved?.length) {
      apiProducts.length = 0;
      for (const r of resolved) {
        apiProducts.push(mapDraftRowToManualApiProduct(r));
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

  try {
    await syncCollectionFromIngestDrafts(admin, {
      ingestId,
      collectionId,
      status: draftRows.length > 0 ? 'ready_for_review' : 'review_required',
      title: videoTitle,
      thumbnailUrl: thumbnail,
    });
    await admin
      .from('ingest_requests')
      .update({
        status: draftRows.length > 0 ? 'ready_for_review' : 'review_required',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ingestId);
  } catch (e) {
    ingestLog('warn', 'manual.collection_sync_failed', {
      ingestId,
      collectionId,
      message: (e as Error).message?.slice(0, 160),
    });
  }

  return {
    ingestId,
    sourceUrl: canonicalUrl,
    platform,
    videoTitle,
    thumbnail: thumbnail ?? undefined,
    stashScore: 4.5,
    products: apiProducts,
    status: draftRows.length > 0 ? 'ready_for_review' : 'review_required',
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
      failedProductUrls,
    },
    failedProductUrls,
  };
}

/** Hydration recovery: re-run PI only for drafts that are not already terminal. */
export async function retryUnresolvedIngestDrafts(
  admin: SupabaseClient,
  ingestId: string,
): Promise<{ ranResolver: boolean }> {
  const { data: rows } = await admin
    .from('ingest_draft_products')
    .select('catalog_product_id, resolution_status, provider')
    .eq('ingest_request_id', ingestId);
  const needsResolve = (rows ?? []).some((r) =>
    ingestDraftNeedsProductResolve({
      catalogProductId: (r.catalog_product_id as string) ?? null,
      resolutionStatus: (r.resolution_status as string) ?? null,
    }),
  );
  if (!needsResolve) {
    return { ranResolver: false };
  }

  const creatorSuppliedUrl = (rows ?? []).some((r) => (r.provider as string | null) === 'manual');
  await resolveIngestDrafts(admin, ingestId, ingestId, {
    creatorSuppliedUrl,
    onlyUnresolved: true,
  });

  const { data: ingest } = await admin
    .from('ingest_requests')
    .select('collection_id, video_title, thumbnail')
    .eq('id', ingestId)
    .maybeSingle();
  const collectionId = (ingest?.collection_id as string | null) ?? null;
  if (collectionId) {
    try {
      const { syncCollectionFromIngestDrafts } = await import('./collection/ingestBridge');
      await syncCollectionFromIngestDrafts(admin, {
        ingestId,
        collectionId,
        status: 'ready_for_review',
        title: (ingest?.video_title as string) ?? null,
        thumbnailUrl: (ingest?.thumbnail as string) ?? null,
      });
    } catch (e) {
      ingestLog('warn', 'manual.retry_collection_sync_failed', {
        ingestId,
        collectionId,
        message: (e as Error).message?.slice(0, 160),
      });
    }
  }
  return { ranResolver: true };
}
