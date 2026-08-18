import { curationLog, curationLogIngestResult, curationLogIngestStart } from '@/src/logging/curationLog';
import { supabase } from '@/src/services/supabase';
import { setCurationDraft } from '@/src/state/curationDraftStore';
import type {
  ExtractionPipelineMetaClient,
  IngestDraftPayload,
  IngestUrlResponse,
} from '@/src/types/curation';
import { mapIngestApiProductToDraft } from '@/src/services/ingestApiProductMap';

/** Map Supabase / fetch failures to a single user-facing network hint (no crash). */
export function normalizeIngestError(e: unknown): string {
  let msg: string;
  if (e instanceof Error) {
    msg = e.message;
  } else if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    msg = (e as { message: string }).message;
  } else {
    msg = String(e);
  }
  const lower = msg.toLowerCase();
  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('could not connect') ||
    lower.includes('internet connection appears to be offline') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    (lower.includes('fetch') && lower.includes('network'))
  ) {
    return 'Network unavailable. Check your connection and try again.';
  }
  return msg.slice(0, 500);
}

/** RN / web fetch often surfaces unreachable LAN HTTP as one of these. */
function isLikelyClientFetchNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message === 'Network request failed' ||
    lower.includes('failed to fetch') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('could not connect')
  );
}

function backendUnreachableMessage(ingestApiBase: string): string {
  return `Cannot reach Mystash backend (${ingestApiBase}). Use your computer's LAN IP on a physical phone (not localhost or 127.0.0.1). Android emulator: http://10.0.2.2:8787. Phone and PC must be on the same Wi‑Fi; allow port 8787 in the firewall. Expo Go can block plain HTTP to a LAN IP—if this keeps failing, run ngrok (e.g. ngrok http 8787), set EXPO_PUBLIC_MYSTASH_INGEST_URL to the https ngrok URL, and restart Expo with npx expo start --clear.`;
}

/** Ingest + publish require the Node backend; Edge functions are not invoked by the app anymore. */
function getIngestApiBaseOrThrow(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'Set EXPO_PUBLIC_MYSTASH_INGEST_URL to your Mystash Node backend (e.g. http://192.168.1.5:8787). The app no longer calls Supabase Edge for ingest or publish.',
    );
  }
  return base;
}

type EdgeIngestBody = {
  ingestId: string;
  sourceUrl: string;
  platform: string;
  videoTitle?: string;
  thumbnail?: string;
  stashScore?: number;
  products: Array<{
    id: string;
    name: string;
    price: string;
    currency?: string;
    provider: string;
    affiliateUrl: string;
    merchantUrl?: string;
    image?: string;
    confidence?: number;
    catalogProductId?: string;
    resolutionStatus?: 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';
    brand?: string | null;
  }>;
  status: string;
  errorMessage?: string;
  extractionSource?: string;
  extractionStatus?: string;
  extractionError?: { code: string; message: string; detail?: string } | null;
  pipelineMeta?: ExtractionPipelineMetaClient | null;
  extractionDurationMs?: number;
  traceId?: string;
  /** Async extraction — client polls until status is `draft` or `ready_for_review` (or terminal failure). */
  extractionPending?: boolean;
};

function mapEdgeToDraft(body: EdgeIngestBody): IngestDraftPayload {
  const extractionError =
    body.extractionError === null || body.extractionError === undefined
      ? undefined
      : body.extractionError;
  let extractionStatus: IngestDraftPayload['extractionStatus'];
  if (body.extractionPending && body.extractionStatus === undefined) {
    extractionStatus = undefined;
  } else if (body.extractionStatus === 'ok' || body.extractionStatus === 'degraded') {
    extractionStatus = body.extractionStatus;
  } else {
    extractionStatus =
      (body.extractionSource === 'gemini' ||
        body.extractionSource === 'openai' ||
        body.extractionSource === 'manual') &&
      !extractionError
        ? 'ok'
        : 'degraded';
  }

  let status: IngestDraftPayload['status'] = 'draft';
  if (body.status === 'failed') status = 'failed';
  else if (body.status === 'processing') status = 'processing';
  else if (body.status === 'ready_for_review') status = 'ready_for_review';
  else if (body.status === 'review_required') status = 'review_required';
  else if (body.status === 'rejected') status = 'rejected';

  return {
    ingestId: body.ingestId,
    sourceUrl: body.sourceUrl,
    platform: (body.platform as IngestDraftPayload['platform']) ?? 'unknown',
    videoTitle: body.videoTitle,
    thumbnail: body.thumbnail,
    stashScore: body.stashScore,
    products: body.products.map((p) => mapIngestApiProductToDraft(p)),
    status,
    errorMessage: body.errorMessage,
    extractionSource: body.extractionSource,
    extractionStatus,
    extractionError,
    pipelineMeta: body.pipelineMeta === null ? undefined : body.pipelineMeta ?? undefined,
    extractionDurationMs: body.extractionDurationMs,
    traceId: body.traceId,
    extractionPending: body.extractionPending,
  };
}

/**
 * Async ingest polling: 3s interval.
 * Default wait **5 minutes** — Gemini + captions + optional 429 backoff often exceeds 60s.
 */
export const INGEST_ASYNC_POLL_INTERVAL_MS = 3000;
export const INGEST_ASYNC_POLL_TIMEOUT_MS = 300_000;

async function pollIngestUntilDraftReady(
  ingestId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? INGEST_ASYNC_POLL_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? INGEST_ASYNC_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('ingest_requests').select('status').eq('id', ingestId).maybeSingle();

    if (error) {
      throw new Error(normalizeIngestError(error));
    }

    const done =
      data?.status === 'draft' ||
      data?.status === 'ready_for_review' ||
      data?.status === 'review_required' ||
      data?.status === 'failed' ||
      data?.status === 'rejected';
    if (done) {
      return;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const sec = Math.round(timeoutMs / 1000);
  throw new Error(
    `Extraction is still in progress after ${sec}s (worker may be waiting on Gemini or rate limits). Open Create → Your drafts and tap this item when it shows Ready, or pull to refresh.`,
  );
}

/** Load draft row + products + extraction payload from Supabase (RLS: owner only). */
export async function loadIngestDraftPayload(ingestId: string): Promise<IngestDraftPayload | null> {
  const { data: ir, error: irErr } = await supabase
    .from('ingest_requests')
    .select('id, source_url, platform, video_title, thumbnail, stash_score, status')
    .eq('id', ingestId)
    .maybeSingle();

  if (irErr || !ir) return null;

  const { data: rows } = await supabase
    .from('ingest_draft_products')
    .select(
      `external_id, name, price, currency, image, affiliate_url, merchant_url, provider, confidence, brand,
       catalog_product_id, resolution_status,
       catalog_products (
         id, name, brand, merchant, image_url, price, currency,
         description, availability, verification_status, last_verified_at, metadata
       )`,
    )
    .eq('ingest_request_id', ingestId);

  const { data: extMeta } = await supabase
    .from('ingest_extractions')
    .select('payload')
    .eq('ingest_request_id', ingestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const extPayload = extMeta?.payload as Record<string, unknown> | undefined;
  const extractionSource =
    typeof extPayload?.extractionSource === 'string' ? extPayload.extractionSource : undefined;
  const extractionDurationMs =
    typeof extPayload?.durationMs === 'number' ? extPayload.durationMs : undefined;
  const traceId = typeof extPayload?.traceId === 'string' ? extPayload.traceId : undefined;
  const extractionStatusRaw = extPayload?.extractionStatus;
  const extractionStatus: IngestDraftPayload['extractionStatus'] =
    extractionStatusRaw === 'ok' || extractionStatusRaw === 'degraded'
      ? extractionStatusRaw
      : extractionSource === 'gemini' || extractionSource === 'openai' || extractionSource === 'manual'
        ? 'ok'
        : 'degraded';
  const extractionError =
    extPayload?.extractionError &&
    typeof extPayload.extractionError === 'object' &&
    extPayload.extractionError !== null &&
    'code' in extPayload.extractionError &&
    'message' in extPayload.extractionError
      ? (extPayload.extractionError as { code: string; message: string; detail?: string })
      : undefined;
  const pipelineMeta =
    extPayload?.pipelineMeta && typeof extPayload.pipelineMeta === 'object'
      ? (extPayload.pipelineMeta as ExtractionPipelineMetaClient)
      : undefined;

  type CatJoin = {
    id: string;
    name: string;
    price: string | null;
    image_url: string | null;
    merchant: string | null;
    brand: string | null;
    currency: string | null;
    description: string | null;
    availability: string | null;
    verification_status: string | null;
    last_verified_at: string | null;
    metadata: Record<string, unknown> | null;
  };

  const products: IngestDraftPayload['products'] = (rows ?? []).map((r) => {
    const rawCat = (r as { catalog_products?: CatJoin | CatJoin[] | null }).catalog_products;
    const cat = Array.isArray(rawCat) ? rawCat[0] : rawCat;
    const catalogProductId =
      (r.catalog_product_id as string) || cat?.id || undefined;
    const resolutionRaw = (r.resolution_status as string) || cat?.verification_status;
    const resolutionStatus =
      resolutionRaw === 'VERIFIED' || resolutionRaw === 'UNVERIFIED' || resolutionRaw === 'UNRESOLVED'
        ? resolutionRaw
        : undefined;

    if (cat) {
      return {
        id: r.external_id as string,
        name: cat.name,
        price: cat.price || '—',
        currency: cat.currency ?? undefined,
        provider: cat.merchant || 'catalog',
        affiliateUrl: '',
        merchant: cat.merchant ?? undefined,
        image: cat.image_url ?? undefined,
        confidence: (r.confidence as number) ?? undefined,
        catalogProductId,
        resolutionStatus,
        brand: cat.brand,
        description: cat.description,
        catalogRow: {
          id: cat.id,
          name: cat.name,
          brand: cat.brand,
          merchant: cat.merchant,
          image_url: cat.image_url,
          price: cat.price,
          currency: cat.currency,
          description: cat.description,
          availability: cat.availability,
          verification_status: cat.verification_status,
          last_verified_at: cat.last_verified_at,
          metadata: cat.metadata,
        },
      };
    }

    const merchantUrl = (r.merchant_url as string) || undefined;
    let merchant: string | undefined = (r.provider as string) || undefined;
    if (merchantUrl) {
      try {
        merchant = new URL(merchantUrl).hostname.replace(/^www\./, '');
      } catch {
        /* keep provider */
      }
    }
    if (merchant === 'ai_extract' || merchant === 'unknown' || merchant === 'serper') {
      merchant = undefined;
    }
    return {
      id: r.external_id as string,
      name: r.name as string,
      price: r.price as string,
      currency: (r.currency as string) ?? undefined,
      provider: (r.provider as string) ?? 'unknown',
      affiliateUrl: (r.affiliate_url as string) || '',
      merchantUrl,
      merchant,
      image: (r.image as string) ?? undefined,
      confidence: (r.confidence as number) ?? undefined,
      catalogProductId,
      resolutionStatus,
      brand: (r.brand as string) ?? null,
      catalogRow: null,
    };
  });

  const rowStatus = ir.status as string;
  let status: IngestDraftPayload['status'] = 'draft';
  if (rowStatus === 'failed') status = 'failed';
  else if (rowStatus === 'processing') status = 'processing';
  else if (rowStatus === 'ready_for_review') status = 'ready_for_review';
  else if (rowStatus === 'review_required') status = 'review_required';
  else if (rowStatus === 'rejected') status = 'rejected';

  return {
    ingestId: ir.id as string,
    sourceUrl: ir.source_url as string,
    platform: (ir.platform as IngestDraftPayload['platform']) ?? 'unknown',
    videoTitle: (ir.video_title as string) ?? undefined,
    thumbnail: (ir.thumbnail as string) ?? undefined,
    stashScore: Number(ir.stash_score) || 4.5,
    products,
    status,
    extractionSource,
    extractionStatus,
    extractionError,
    pipelineMeta,
    extractionDurationMs,
    traceId,
    extractionPending: rowStatus === 'processing' && products.length === 0,
  };
}

export type UserDraftIngestSummary = {
  id: string;
  sourceUrl: string;
  status: string;
  videoTitle?: string;
  thumbnail?: string;
  updatedAt: string;
};

/** Draft / processing ingests for the signed-in user (for “resume after cold start”). */
export async function listUserDraftIngests(): Promise<UserDraftIngestSummary[]> {
  const { data, error } = await supabase
    .from('ingest_requests')
    .select('id, source_url, status, video_title, thumbnail, updated_at')
    .in('status', ['draft', 'processing', 'ready_for_review', 'review_required', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(25);

  if (error) {
    curationLog('warn', 'ingest.list_drafts_failed', { message: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    sourceUrl: row.source_url as string,
    status: row.status as string,
    videoTitle: (row.video_title as string) ?? undefined,
    thumbnail: (row.thumbnail as string) ?? undefined,
    updatedAt: (row.updated_at as string) ?? '',
  }));
}

/**
 * Cold-start path: load draft from DB; if still extracting, poll until `draft` or timeout then reload.
 * Updates in-memory `curationDraftStore`.
 */
export async function loadOrResumeIngestDraft(ingestId: string): Promise<IngestDraftPayload | null> {
  let payload = await loadIngestDraftPayload(ingestId);
  if (!payload) return null;

  if (payload.status === 'processing' && payload.products.length === 0) {
    try {
      await pollIngestUntilDraftReady(ingestId);
    } catch {
      /* timeout / network — still return latest snapshot below */
    }
    payload = (await loadIngestDraftPayload(ingestId)) ?? payload;
  }

  setCurationDraft(ingestId, payload);
  return payload;
}

/** Recovery: ask the backend to re-run ProductResolver only for genuinely unresolved drafts. */
export async function retryUnresolvedIngestDrafts(
  ingestId: string,
): Promise<{ ranResolver: boolean }> {
  const ingestApiBase = getIngestApiBaseOrThrow();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!token) {
    throw new Error('Sign in required.');
  }

  let res: Response;
  try {
    res = await fetch(`${ingestApiBase}/ingest/${encodeURIComponent(ingestId)}/resolve-unresolved`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(anon ? { apikey: anon } : {}),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isLikelyClientFetchNetworkFailure(msg)) {
      throw new Error(backendUnreachableMessage(ingestApiBase));
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw.length ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Invalid JSON from resolve-unresolved (HTTP ${res.status}).`);
  }
  const json = parsed as { ok?: boolean; ranResolver?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(normalizeIngestError(json.error ?? `HTTP ${res.status}`));
  }
  return { ranResolver: json.ranResolver === true };
}

export type SubmitIngestUrlOptions = {
  /**
   * Called synchronously when Edge returns `extractionPending: true`, before polling `ingest_requests`.
   * Use this to switch the UI to a Processing state immediately.
   */
  onProcessing?: () => void;
  /** Optional display title for the reel (stored on ingest and used when publishing to the feed). */
  videoTitle?: string;
};

/** Manual flow: backend fetches OG / JSON-LD for each product link and writes draft rows. */
export async function submitManualProductLinks(
  videoUrl: string,
  productUrls: string[],
  opts?: { videoTitle?: string },
): Promise<IngestUrlResponse> {
  const trimmedVideo = videoUrl.trim();
  const ingestApiBase = getIngestApiBaseOrThrow();

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!token) {
    throw new Error('Sign in required.');
  }

  let res: Response;
  try {
    res = await fetch(`${ingestApiBase}/ingest/manual`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(anon ? { apikey: anon } : {}),
      },
      body: JSON.stringify({
        source_url: trimmedVideo,
        product_urls: productUrls,
        ...(opts?.videoTitle?.trim()
          ? { video_title: opts.videoTitle.trim().slice(0, 200) }
          : {}),
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isLikelyClientFetchNetworkFailure(msg)) {
      throw new Error(backendUnreachableMessage(ingestApiBase));
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw.length ? JSON.parse(raw) : null;
  } catch {
    const startsHtml = raw.trimStart().startsWith('<');
    throw new Error(
      startsHtml
        ? 'Manual ingest server returned HTML (check EXPO_PUBLIC_MYSTASH_INGEST_URL).'
        : `Invalid JSON from manual ingest (HTTP ${res.status}).`,
    );
  }

  const json = parsed as EdgeIngestBody & { error?: string; failedProductUrls?: string[] };
  if (!res.ok) {
    throw new Error(normalizeIngestError(json.error ?? `HTTP ${res.status}`));
  }

  const draft = mapEdgeToDraft(json);
  setCurationDraft(draft.ingestId, draft);
  curationLogIngestResult({
    ok: true,
    ingestId: draft.ingestId,
    status: 'ok',
    extractionSource: draft.extractionSource,
    extractionStatus: draft.extractionStatus,
    extractionDurationMs: draft.extractionDurationMs,
    traceId: draft.traceId,
    extractionErrorCode: draft.extractionError?.code,
  });
  const failedProductUrls = Array.isArray(json.failedProductUrls)
    ? json.failedProductUrls.filter((u): u is string => typeof u === 'string')
    : undefined;
  return { ingestId: draft.ingestId, status: 'ok', draft, failedProductUrls };
}

export async function submitIngestUrl(
  sourceUrl: string,
  options?: SubmitIngestUrlOptions,
): Promise<IngestUrlResponse> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    curationLog('warn', 'ingest.submit.empty_url', {});
    return { ingestId: '', status: 'error' };
  }

  curationLogIngestStart(trimmed);

  let data: EdgeIngestBody | null = null;
  let invokeErr: unknown = null;

  let ingestApiBase: string;
  try {
    ingestApiBase = getIngestApiBaseOrThrow();
  } catch (e) {
    const m = (e as Error).message;
    curationLogIngestResult({ ok: false, status: 'error', error: m });
    throw new Error(normalizeIngestError(m));
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!token) {
      invokeErr = new Error('Sign in required.');
    } else {
      const res = await fetch(`${ingestApiBase}/ingest`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(anon ? { apikey: anon } : {}),
        },
        body: JSON.stringify({
          source_url: trimmed,
          ...(options?.videoTitle?.trim()
            ? { video_title: options.videoTitle.trim().slice(0, 200) }
            : {}),
        }),
      });
      const raw = await res.text();
      let parsed: unknown;
      try {
        parsed = raw.length ? JSON.parse(raw) : null;
      } catch {
        const startsHtml = raw.trimStart().startsWith('<');
        invokeErr = new Error(
          startsHtml
            ? 'Ingest server returned HTML instead of JSON (wrong URL or unreachable API). On Expo Go use your computer’s LAN IP, e.g. http://192.168.x.x:8787 — not localhost or 127.0.0.1. Ensure the backend is running and phone and PC share Wi‑Fi.'
            : `Invalid JSON from ingest server (HTTP ${res.status}): ${raw.slice(0, 160).trim()}`,
        );
      }
      if (!invokeErr && parsed && typeof parsed === 'object') {
        const json = parsed as EdgeIngestBody & { error?: string };
        if (!res.ok) {
          invokeErr = new Error(json.error ?? `HTTP ${res.status}`);
        } else {
          data = json as EdgeIngestBody;
        }
      } else if (!invokeErr && parsed === null && !res.ok) {
        invokeErr = new Error(`HTTP ${res.status}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isLikelyClientFetchNetworkFailure(msg)) {
      invokeErr = new Error(backendUnreachableMessage(ingestApiBase));
    } else {
      invokeErr = e;
    }
  }

  if (!invokeErr && data?.ingestId) {
    let draft = mapEdgeToDraft(data);
    if (data.extractionPending) {
      options?.onProcessing?.();
      try {
        await pollIngestUntilDraftReady(draft.ingestId);
      } catch {
        /** Race: poll ended just before worker wrote `draft`; one final read avoids a false failure. */
        const late = await loadIngestDraftPayload(draft.ingestId);
        if (
          late?.status === 'draft' ||
          late?.status === 'ready_for_review' ||
          late?.status === 'review_required'
        ) {
          draft = late;
          setCurationDraft(draft.ingestId, draft);
          curationLogIngestResult({
            ok: true,
            ingestId: draft.ingestId,
            status: 'ok',
            extractionSource: draft.extractionSource,
            extractionStatus: draft.extractionStatus,
            extractionDurationMs: draft.extractionDurationMs,
            traceId: draft.traceId,
            extractionErrorCode: draft.extractionError?.code,
          });
          return { ingestId: draft.ingestId, status: 'ok', draft };
        }
        throw new Error(
          `Extraction is still running on the server after ${INGEST_ASYNC_POLL_TIMEOUT_MS / 1000}s. Go to Create → Your drafts — tap the ingest when it shows Ready (the worker runs in the background).`,
        );
      }
      const refreshed = await loadIngestDraftPayload(draft.ingestId);
      if (!refreshed) {
        throw new Error('Could not load draft products after extraction finished.');
      }
      if (refreshed.status === 'rejected') {
        throw new Error('This video did not pass automated content review.');
      }
      draft = refreshed;
    }
    setCurationDraft(draft.ingestId, draft);
    curationLogIngestResult({
      ok: true,
      ingestId: draft.ingestId,
      status: 'ok',
      extractionSource: draft.extractionSource,
      extractionStatus: draft.extractionStatus,
      extractionDurationMs: draft.extractionDurationMs,
      traceId: draft.traceId,
      extractionErrorCode: draft.extractionError?.code,
    });
    return { ingestId: draft.ingestId, status: 'ok', draft };
  }

  const msg =
    invokeErr instanceof Error
      ? invokeErr.message
      : invokeErr &&
          typeof invokeErr === 'object' &&
          invokeErr !== null &&
          'message' in invokeErr &&
          typeof (invokeErr as { message: unknown }).message === 'string'
        ? (invokeErr as { message: string }).message
        : invokeErr != null
          ? String(invokeErr)
          : 'Ingest did not return an ingest id. Try again.';

  curationLogIngestResult({ ok: false, status: 'error', error: msg });
  throw new Error(normalizeIngestError(invokeErr ?? msg));
}

type PublishIngestBody = {
  ingest_id: string;
  selected_product_ids: string[];
  source_url: string;
  platform: string;
  reject_all: boolean;
};

async function invokePublishIngest(
  body: PublishIngestBody,
): Promise<{ ok: boolean; videoId?: string; error?: string }> {
  let ingestApiBase: string;
  try {
    ingestApiBase = getIngestApiBaseOrThrow();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!token) {
    return { ok: false, error: 'Sign in required.' };
  }
  try {
    const res = await fetch(`${ingestApiBase}/publish`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(anon ? { apikey: anon } : {}),
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw.length ? JSON.parse(raw) : null;
    } catch {
      return { ok: false, error: `Invalid JSON from publish (${res.status})` };
    }
    const json = parsed as { ok?: boolean; videoId?: string; error?: string; detail?: string };
    if (!res.ok) {
      const parts = [json.error, json.detail].filter(Boolean);
      return { ok: false, error: parts.join(' ') || `HTTP ${res.status}` };
    }
    return { ok: !!json.ok, videoId: json.videoId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isLikelyClientFetchNetworkFailure(msg)) {
      return { ok: false, error: backendUnreachableMessage(ingestApiBase) };
    }
    return { ok: false, error: normalizeIngestError(e) };
  }
}

export async function publishIngestSelection(
  ingestId: string,
  selectedProductIds: string[],
  draft: IngestDraftPayload,
): Promise<{ ok: boolean; error?: string; videoId?: string }> {
  if (ingestId.trim() !== draft.ingestId.trim()) {
    return {
      ok: false,
      error: 'Publish request does not match this draft. Go back to Create and open the draft again.',
    };
  }
  const ids = selectedProductIds.map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, error: 'No products selected to publish.' };
  }
  const result = await invokePublishIngest({
    ingest_id: draft.ingestId,
    selected_product_ids: ids,
    source_url: draft.sourceUrl,
    platform: draft.platform,
    reject_all: false,
  });
  if (result.ok) {
    return { ok: true, videoId: result.videoId };
  }
  return { ok: false, error: result.error ?? 'Publish failed' };
}

export async function rejectIngestRequest(ingestId: string, draft: IngestDraftPayload): Promise<{ ok: boolean; error?: string }> {
  if (ingestId.trim() !== draft.ingestId.trim()) {
    return { ok: false, error: 'Draft mismatch.' };
  }
  const result = await invokePublishIngest({
    ingest_id: draft.ingestId,
    selected_product_ids: [],
    source_url: draft.sourceUrl,
    platform: draft.platform,
    reject_all: true,
  });
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, error: result.error ?? 'Reject failed' };
}
