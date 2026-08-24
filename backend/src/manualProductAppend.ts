import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestLog } from './pipeline/ingestLog';
import {
  canonicalizeProductUrl,
  externalIdForProductUrl,
} from './pipeline/productLinkPreview';
import { MerchantEnrichmentService } from './product-intelligence/enrichment/MerchantEnrichmentService';
import { TavilyMerchantExtractor } from './product-intelligence/enrichment/TavilyMerchantExtractor';
import { resolveIngestDrafts } from './product-intelligence';
import {
  mapDraftRowToManualApiProduct,
  type ManualIngestApiProduct,
  type ManualIngestProductRow,
} from './manualIngest';

export class ManualAppendError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = 'ManualAppendError';
  }
}

/** Statuses that may receive manual product appends (never `processing`). */
export const MANUAL_APPEND_ALLOWED_STATUSES = [
  'draft',
  'ready_for_review',
  'review_required',
  'failed',
] as const;

export type ManualAppendAllowedStatus = (typeof MANUAL_APPEND_ALLOWED_STATUSES)[number];

export function isManualAppendAllowedStatus(status: string): status is ManualAppendAllowedStatus {
  return (MANUAL_APPEND_ALLOWED_STATUSES as readonly string[]).includes(status);
}

export function assertManualAppendAllowed(status: string): void {
  if (status === 'processing') {
    throw new ManualAppendError(
      'PROCESSING_LOCKED',
      'Manual products cannot be added while automatic video extraction is in progress.',
      409,
    );
  }
  if (!isManualAppendAllowedStatus(status)) {
    throw new ManualAppendError(
      'INGEST_NOT_EDITABLE',
      `This Collection cannot accept manual products in status "${status}".`,
      400,
    );
  }
}

export function normalizeManualProductUrls(productUrls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of productUrls) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    let canonical: string;
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      canonical = canonicalizeProductUrl(u.href);
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

export function planManualProductAppend(params: {
  productUrls: string[];
  existingExternalIds: Iterable<string>;
}): {
  canonicalUrls: string[];
  urlsToAdd: string[];
  alreadyPresentExternalIds: string[];
  externalIdsToAdd: string[];
} {
  const canonicalUrls = normalizeManualProductUrls(params.productUrls);
  const existing = new Set(
    [...params.existingExternalIds].map((id) => String(id ?? '')).filter(Boolean),
  );
  const urlsToAdd: string[] = [];
  const externalIdsToAdd: string[] = [];
  const alreadyPresentExternalIds: string[] = [];
  for (const url of canonicalUrls) {
    const externalId = externalIdForProductUrl(url);
    if (existing.has(externalId)) {
      alreadyPresentExternalIds.push(externalId);
      continue;
    }
    existing.add(externalId);
    urlsToAdd.push(url);
    externalIdsToAdd.push(externalId);
  }
  return { canonicalUrls, urlsToAdd, alreadyPresentExternalIds, externalIdsToAdd };
}

export type AppendManualProductsResult = {
  ingestId: string;
  sourceUrl: string;
  platform: string;
  videoTitle: string;
  thumbnail?: string;
  stashScore: number;
  products: ManualIngestApiProduct[];
  status: string;
  extractionPending: false;
  /** Unchanged video extraction provenance — never rewritten as `manual`. */
  extractionSource?: string;
  extractionDurationMs: number;
  traceId: string;
  extractionStatus?: string;
  extractionError: null;
  pipelineMeta: Record<string, unknown>;
  failedProductUrls?: string[];
  /** True when every submitted URL already existed — zero downstream mutations. */
  noop: boolean;
  addedExternalIds: string[];
};

/**
 * Append creator-supplied product URLs to an exact ingest.
 * Never creates a new ingest/Collection. Never mutates video/media lifecycle.
 */
export async function appendManualProductsToIngest(
  admin: SupabaseClient,
  params: {
    userId: string;
    ingestId: string;
    productUrls: string[];
    traceId: string;
  },
): Promise<AppendManualProductsResult> {
  const { userId, ingestId, productUrls, traceId } = params;

  const { data: ingest, error: ingestErr } = await admin
    .from('ingest_requests')
    .select(
      'id, user_id, status, source_url, platform, video_title, thumbnail, stash_score, collection_id',
    )
    .eq('id', ingestId)
    .maybeSingle();

  if (ingestErr) {
    throw new ManualAppendError('INGEST_LOOKUP_FAILED', ingestErr.message, 500);
  }
  if (!ingest || ingest.user_id !== userId) {
    throw new ManualAppendError('INGEST_NOT_FOUND', 'Ingest not found', 404);
  }

  const status = String(ingest.status ?? '');
  assertManualAppendAllowed(status);

  const { data: existingDraftRows } = await admin
    .from('ingest_draft_products')
    .select(
      'external_id, name, price, currency, image, affiliate_url, provider, confidence, merchant_url, brand, catalog_product_id, resolution_status',
    )
    .eq('ingest_request_id', ingestId);

  const existingExternalIds = (existingDraftRows ?? []).map((r) => String(r.external_id ?? ''));
  const plan = planManualProductAppend({
    productUrls,
    existingExternalIds,
  });

  if (plan.canonicalUrls.length < 1) {
    throw new ManualAppendError(
      'PRODUCT_URLS_REQUIRED',
      'Add 1–5 unique http(s) product links',
      400,
    );
  }
  if (plan.canonicalUrls.length > 5) {
    throw new ManualAppendError(
      'PRODUCT_URLS_LIMIT',
      'Add 1–5 unique http(s) product links',
      400,
    );
  }

  const loadExtractionProvenance = async () => {
    const { data: extMeta } = await admin
      .from('ingest_extractions')
      .select('payload')
      .eq('ingest_request_id', ingestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const extPayload = extMeta?.payload as Record<string, unknown> | undefined;
    return {
      extractionSource:
        typeof extPayload?.extractionSource === 'string' ? extPayload.extractionSource : undefined,
      extractionStatus:
        extPayload?.extractionStatus === 'ok' || extPayload?.extractionStatus === 'degraded'
          ? (extPayload.extractionStatus as string)
          : undefined,
      extractionDurationMs:
        typeof extPayload?.durationMs === 'number' ? extPayload.durationMs : undefined,
    };
  };

  const loadProducts = async (): Promise<ManualIngestApiProduct[]> => {
    const { data: rows } = await admin
      .from('ingest_draft_products')
      .select(
        'external_id, name, price, currency, image, affiliate_url, provider, confidence, merchant_url, brand, catalog_product_id, resolution_status',
      )
      .eq('ingest_request_id', ingestId);
    return (rows ?? []).map((r) => mapDraftRowToManualApiProduct(r));
  };

  const baseMeta = {
    transcriptAgent: 'not_applicable',
    contextSources: ['manual_links'],
    priceAgent: 'link_preview',
    appendMode: true,
    ingestId,
  };

  if (plan.urlsToAdd.length === 0) {
    ingestLog('info', 'manual.append_noop', {
      ingestId,
      userId,
      duplicateCount: plan.alreadyPresentExternalIds.length,
    });
    const provenance = await loadExtractionProvenance();
    return {
      ingestId,
      sourceUrl: String(ingest.source_url ?? ''),
      platform: String(ingest.platform ?? 'unknown'),
      videoTitle: String(ingest.video_title ?? 'Draft'),
      thumbnail: (ingest.thumbnail as string | null) ?? undefined,
      stashScore: Number(ingest.stash_score) || 4.5,
      products: await loadProducts(),
      status,
      extractionPending: false,
      extractionSource: provenance.extractionSource,
      extractionDurationMs: provenance.extractionDurationMs ?? 0,
      traceId,
      extractionStatus: provenance.extractionStatus,
      extractionError: null,
      pipelineMeta: { ...baseMeta, noop: true, reusedExternalIds: plan.alreadyPresentExternalIds },
      failedProductUrls: [],
      noop: true,
      addedExternalIds: [],
    };
  }

  const enrichment = new MerchantEnrichmentService(new TavilyMerchantExtractor(admin));
  const enrichResults = await Promise.all(
    plan.urlsToAdd.map((u) =>
      enrichment.enrich({
        merchantUrl: u,
        ingestId,
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
    const url = plan.urlsToAdd[i]!;
    if (result.kind === 'failed') {
      ingestLog('warn', 'manual.append_enrichment_failed', {
        ingestId,
        message: result.message,
        url: url.slice(0, 120),
      });
      failedProductUrls.push(url);
      continue;
    }
    okMeta.push(result.metadata);
  }

  if (okMeta.length === 0) {
    throw new ManualAppendError(
      'ENRICHMENT_FAILED',
      `Could not extract product details from the provided link${plan.urlsToAdd.length > 1 ? 's' : ''}. Check that each URL is a public product page.`,
      400,
    );
  }

  const draftRows: ManualIngestProductRow[] = [];
  const addedExternalIds: string[] = [];
  for (const preview of okMeta) {
    const externalId = externalIdForProductUrl(preview.merchantUrl);
    if (existingExternalIds.includes(externalId) || addedExternalIds.includes(externalId)) {
      continue;
    }
    addedExternalIds.push(externalId);
    draftRows.push({
      ingest_request_id: ingestId,
      external_id: externalId,
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
  }

  if (draftRows.length === 0) {
    const provenance = await loadExtractionProvenance();
    return {
      ingestId,
      sourceUrl: String(ingest.source_url ?? ''),
      platform: String(ingest.platform ?? 'unknown'),
      videoTitle: String(ingest.video_title ?? 'Draft'),
      thumbnail: (ingest.thumbnail as string | null) ?? undefined,
      stashScore: Number(ingest.stash_score) || 4.5,
      products: await loadProducts(),
      status,
      extractionPending: false,
      extractionSource: provenance.extractionSource,
      extractionDurationMs: provenance.extractionDurationMs ?? 0,
      traceId,
      extractionStatus: provenance.extractionStatus,
      extractionError: null,
      pipelineMeta: {
        ...baseMeta,
        noop: true,
        failedProductUrls,
      },
      failedProductUrls,
      noop: true,
      addedExternalIds: [],
    };
  }

  const { error: insErr } = await admin.from('ingest_draft_products').insert(draftRows);
  if (insErr) {
    ingestLog('error', 'manual.append_insert_failed', {
      ingestId,
      message: insErr.message,
      code: insErr.code,
    });
    throw new ManualAppendError(
      'DRAFT_INSERT_FAILED',
      `Could not save draft products: ${insErr.message}`,
      500,
    );
  }

  // Resolve ONLY newly inserted manual drafts. Never apply creatorSuppliedUrl to AI drafts.
  try {
    await resolveIngestDrafts(admin, ingestId, traceId, {
      externalIds: addedExternalIds,
      creatorSuppliedUrlForExternalIds: addedExternalIds,
    });
  } catch (e) {
    ingestLog('warn', 'manual.append_resolve_failed', {
      ingestId,
      message: (e as Error).message?.slice(0, 160),
    });
  }

  const collectionId = (ingest.collection_id as string | null) ?? null;
  if (collectionId) {
    try {
      const { upsertManualProductTagsFromDrafts } = await import('./collection/ingestBridge');
      await upsertManualProductTagsFromDrafts(admin, {
        ingestId,
        collectionId,
        externalIds: addedExternalIds,
      });
    } catch (e) {
      ingestLog('warn', 'manual.append_tag_sync_failed', {
        ingestId,
        collectionId,
        message: (e as Error).message?.slice(0, 160),
      });
    }
  }

  // Recovery only: failed → review_required when new manual products land.
  // Never touch processing; never rewrite ready_for_review / review_required.
  let nextStatus = status;
  if (status === 'failed' || status === 'draft') {
    nextStatus = 'review_required';
    await admin
      .from('ingest_requests')
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ingestId);
  }

  ingestLog('info', 'manual.append_ok', {
    ingestId,
    userId,
    added: addedExternalIds.length,
    failed: failedProductUrls.length,
  });

  const provenance = await loadExtractionProvenance();
  return {
    ingestId,
    sourceUrl: String(ingest.source_url ?? ''),
    platform: String(ingest.platform ?? 'unknown'),
    videoTitle: String(ingest.video_title ?? 'Draft'),
    thumbnail: (ingest.thumbnail as string | null) ?? undefined,
    stashScore: Number(ingest.stash_score) || 4.5,
    products: await loadProducts(),
    status: nextStatus,
    extractionPending: false,
    extractionSource: provenance.extractionSource,
    extractionDurationMs: provenance.extractionDurationMs ?? 0,
    traceId,
    extractionStatus: provenance.extractionStatus,
    extractionError: null,
    pipelineMeta: {
      ...baseMeta,
      noop: false,
      addedExternalIds,
      failedProductUrls,
    },
    failedProductUrls,
    noop: false,
    addedExternalIds,
  };
}
