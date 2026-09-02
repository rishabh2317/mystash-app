import { Buffer } from 'node:buffer';
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { detectPlatform } from './pipeline/detect';
import { ingestLog } from './pipeline/ingestLog';
import { parseSupportedVideoUrl, unsupportedVideoUrlMessage } from './pipeline/sourceIdentity';
import { createManualIngest, retryUnresolvedIngestDrafts } from './manualIngest';
import {
  appendManualProductsToIngest,
  ManualAppendError,
} from './manualProductAppend';
import { createSupabaseAdmin, createSupabaseUserClient } from './supabase';
import { handlePublishIngest } from './publish';
import { logger } from './logger';
import { enqueueIngestPipeline } from './workers/queue';
import { runProgressiveIngestPipeline } from './stages/orchestrator';
import { startEmbeddedIngestPipelineWorker } from './workers/ingestPipelineWorker';
import { startProductResolveWorker } from './product-intelligence';
import { getEnv } from './env';
import { createProductRedirectHandler } from './shopping/productRedirect';
import { registerCollectionRoutes } from './collection/routes';
import { registerUserRoutes } from './user/routes';
import { registerEngagementRoutes } from './engagement/routes';
import { logSearchRuntime } from './search/factory';
import { registerSearchRoutes } from './search/routes';
import { registerCartRoutes } from './cart/routes';
import { registerProductAiReviewRoutes } from './ai-review/routes';

if (typeof globalThis.btoa !== 'function') {
  Object.assign(globalThis, {
    btoa(bin: string) {
      return Buffer.from(bin, 'binary').toString('base64');
    },
  });
}

const app = express();
const PORT = Number(process.env.PORT) || 8787;
const HOST = '0.0.0.0';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '512kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/products/:id/redirect', createProductRedirectHandler(createSupabaseAdmin()));
registerProductAiReviewRoutes(app, createSupabaseAdmin());

registerCollectionRoutes(app);
registerUserRoutes(app);
registerEngagementRoutes(app);
registerSearchRoutes(app);
registerCartRoutes(app);

logSearchRuntime();

/**
 * Same contract as Edge `ingest-url`: Bearer user JWT; creates `ingest_requests` and returns immediately.
 * Extraction runs in-process via `runBackendIngestPipeline` (no Edge timeout).
 */
/**
 * Manual curation: video URL + 1–5 unique product page URLs.
 * Fetches Open Graph / JSON-LD for each product and writes `ingest_draft_products`.
 */
app.post('/ingest/manual', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }

    const userClient = createSupabaseUserClient(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as { source_url?: string; product_urls?: unknown; video_title?: string; videoTitle?: string };
    const sourceUrl = (body.source_url ?? '').trim();
    if (!sourceUrl) {
      res.status(400).json({ error: 'source_url required' });
      return;
    }

    const platform = detectPlatform(sourceUrl);
    if (platform === 'unknown' || !parseSupportedVideoUrl(sourceUrl)) {
      res.status(400).json({ error: 'Only YouTube Shorts and Instagram Reel / post URLs are supported for the reel' });
      return;
    }

    const rawList = body.product_urls;
    if (!Array.isArray(rawList)) {
      res.status(400).json({ error: 'product_urls must be an array of URLs' });
      return;
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      if (typeof item !== 'string') continue;
      const t = item.trim();
      if (!t) continue;
      try {
        const u = new URL(t);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        u.hash = '';
        const key = u.href;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(key);
      } catch {
        continue;
      }
    }

    if (normalized.length < 1 || normalized.length > 5) {
      res.status(400).json({ error: 'Add 1–5 unique http(s) product links' });
      return;
    }

    const admin = createSupabaseAdmin();
    const traceId = crypto.randomUUID();

    try {
      const videoTitleFromClient = String(body.video_title ?? body.videoTitle ?? '').trim() || undefined;
      const out = await createManualIngest(admin, {
        userId: user.id,
        sourceUrl,
        productUrls: normalized,
        traceId,
        videoTitleFromClient,
      });
      res.json(out);
    } catch (e) {
      const msg = (e as Error).message ?? 'Manual ingest failed';
      ingestLog('warn', 'ingest.manual_failed', { traceId, message: msg.slice(0, 200) });
      res.status(400).json({ error: msg });
    }
  } catch (e) {
    logger.error(e);
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
});

app.post('/ingest/:ingestId/resolve-unresolved', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }
    const userClient = createSupabaseUserClient(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const ingestId = String(req.params.ingestId ?? '').trim();
    if (!ingestId) {
      res.status(400).json({ error: 'ingestId required' });
      return;
    }

    const admin = createSupabaseAdmin();
    const { data: ingest } = await admin
      .from('ingest_requests')
      .select('id, user_id')
      .eq('id', ingestId)
      .maybeSingle();
    if (!ingest || ingest.user_id !== user.id) {
      res.status(404).json({ error: 'Ingest not found' });
      return;
    }

    const out = await retryUnresolvedIngestDrafts(admin, ingestId);
    res.json({ ok: true, ...out });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
});

/**
 * UX-CREATE-B.3 — append product URLs to an exact ingest.
 * Ownership is by ingestId only (never source-URL heuristics).
 */
app.post('/ingest/:ingestId/products', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }
    const userClient = createSupabaseUserClient(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const ingestId = String(req.params.ingestId ?? '').trim();
    if (!ingestId) {
      res.status(400).json({ error: 'ingestId required' });
      return;
    }

    const body = req.body as { product_urls?: unknown };
    const rawList = body.product_urls;
    if (!Array.isArray(rawList)) {
      res.status(400).json({ error: 'product_urls must be an array of URLs' });
      return;
    }
    const productUrls = rawList.filter((u): u is string => typeof u === 'string');

    const admin = createSupabaseAdmin();
    const traceId = crypto.randomUUID();
    try {
      const out = await appendManualProductsToIngest(admin, {
        userId: user.id,
        ingestId,
        productUrls,
        traceId,
      });
      res.json(out);
    } catch (e) {
      if (e instanceof ManualAppendError) {
        res.status(e.httpStatus).json({ error: e.message, code: e.code });
        return;
      }
      throw e;
    }
  } catch (e) {
    logger.error(e);
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
});

app.post('/publish', handlePublishIngest);

app.post('/ingest', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }

    const userClient = createSupabaseUserClient(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const httpTraceId = crypto.randomUUID();
    const admin = createSupabaseAdmin();

    const body = req.body as {
      source_url?: string;
      video_title?: string;
      videoTitle?: string;
      /** `automatic` (default) runs video product extraction; `manual` skips it. */
      product_acquisition?: string;
      productAcquisition?: string;
    };
    const sourceUrl = (body.source_url ?? '').trim();
    if (!sourceUrl) {
      res.status(400).json({ error: 'source_url required' });
      return;
    }
    const acquisitionRaw = String(body.product_acquisition ?? body.productAcquisition ?? 'automatic')
      .trim()
      .toLowerCase();
    const productAcquisition = acquisitionRaw === 'manual' ? 'manual' : 'automatic';

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    const identity = parseSupportedVideoUrl(parsed.href);
    if (!identity) {
      ingestLog('warn', 'ingest.unsupported_platform', { httpTraceId, sourceHost: parsed.hostname });
      res.status(400).json({ error: unsupportedVideoUrlMessage() });
      return;
    }
    const platform = identity.platform;
    const canonicalUrl = identity.canonicalUrl;
    const ytId = platform === 'youtube' ? identity.externalId : null;
    const thumbnail =
      platform === 'youtube' && ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;

    ingestLog('info', 'ingest.accepted', {
      httpTraceId,
      userId: user.id,
      platform,
      sourceHost: parsed.hostname,
      externalId: identity.externalId,
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from('ingest_requests')
      .select('id, status, collection_id')
      .eq('user_id', user.id)
      .in('source_url', [...new Set([canonicalUrl, sourceUrl])])
      .in('status', ['draft', 'processing', 'ready_for_review', 'review_required', 'failed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id && existing.status === 'failed') {
      if (productAcquisition === 'manual') {
        await admin
          .from('ingest_requests')
          .update({ status: 'review_required', updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        res.json({
          ingestId: existing.id,
          sourceUrl: canonicalUrl,
          platform,
          videoTitle: platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel',
          thumbnail: thumbnail ?? undefined,
          stashScore: 4.5,
          products: [],
          status: 'review_required',
          extractionPending: false,
          extractionSource: 'manual_deferred',
          extractionDurationMs: 0,
          traceId: httpTraceId,
          extractionStatus: undefined,
          extractionError: null,
          pipelineMeta: { reused: true, productAcquisition: 'manual', recoveredFromFailed: true },
        });
        return;
      }
      const { resumeFailedIngestForRetry } = await import('./collection/ingestBridge');
      await resumeFailedIngestForRetry(admin, {
        ingestId: existing.id,
        collectionId: (existing.collection_id as string) || null,
      });
      try {
        await enqueueIngestPipeline({ ingestRequestId: existing.id, traceId: httpTraceId });
        ingestLog('info', 'ingest.failed_retry_enqueued', {
          httpTraceId,
          ingestId: existing.id,
        });
      } catch (enqueueErr) {
        ingestLog('warn', 'ingest.failed_retry_enqueue_fallback', {
          httpTraceId,
          ingestId: existing.id,
          message: (enqueueErr as Error).message?.slice(0, 200),
        });
        setImmediate(() => {
          void runProgressiveIngestPipeline(admin, existing.id, httpTraceId).catch((err) => {
            logger.error({ err, ingestId: existing.id }, 'ingest.background_pipeline_failed');
          });
        });
      }
      res.json({
        ingestId: existing.id,
        sourceUrl: canonicalUrl,
        platform,
        videoTitle: platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel',
        thumbnail: thumbnail ?? undefined,
        stashScore: 4.5,
        products: [],
        status: 'processing',
        extractionPending: true,
        extractionSource: 'queued',
        extractionDurationMs: 0,
        traceId: httpTraceId,
        extractionStatus: undefined,
        extractionError: null,
        pipelineMeta: { reused: true, retriedFailed: true },
      });
      return;
    }

    if (existing?.id) {
      const { data: extMeta } = await admin
        .from('ingest_extractions')
        .select('payload')
        .eq('ingest_request_id', existing.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const extPayload = extMeta?.payload as Record<string, unknown> | undefined;
      const extractionSource =
        typeof extPayload?.extractionSource === 'string' ? extPayload.extractionSource : 'unknown';
      const extractionDurationMs =
        typeof extPayload?.durationMs === 'number' ? extPayload.durationMs : undefined;
      const priorTraceId = typeof extPayload?.traceId === 'string' ? extPayload.traceId : undefined;
      const extractionStatus =
        extPayload?.extractionStatus === 'ok' || extPayload?.extractionStatus === 'degraded'
          ? extPayload.extractionStatus
          : extractionSource === 'gemini' || extractionSource === 'openai'
            ? 'ok'
            : 'degraded';
      const extractionError =
        extPayload?.extractionError &&
        typeof extPayload?.extractionError === 'object' &&
        extPayload.extractionError !== null &&
        'code' in extPayload.extractionError &&
        'message' in extPayload.extractionError
          ? (extPayload.extractionError as { code: string; message: string; detail?: string })
          : undefined;
      const pipelineMeta =
        extPayload?.pipelineMeta && typeof extPayload.pipelineMeta === 'object'
          ? extPayload.pipelineMeta
          : undefined;

      const { data: rows } = await admin
        .from('ingest_draft_products')
        .select('external_id, name, price, currency, image, affiliate_url, merchant_url, provider, confidence')
        .eq('ingest_request_id', existing.id);

      const products = (rows ?? []).map((r) => ({
        id: r.external_id,
        name: r.name,
        price: r.price,
        currency: r.currency ?? undefined,
        provider: r.provider ?? 'unknown',
        affiliateUrl: r.affiliate_url,
        merchantUrl: r.merchant_url ?? undefined,
        image: r.image ?? undefined,
        confidence: r.confidence ?? undefined,
      }));

      const { data: ir } = await admin
        .from('ingest_requests')
        .select('source_url, platform, video_title, thumbnail, stash_score, status')
        .eq('id', existing.id)
        .single();

      const rowStatus = ir?.status ?? 'draft';
      const extractionPending = rowStatus === 'processing' && products.length === 0;

      // Recover stuck "processing" rows (e.g. Redis was down when first enqueued).
      if (extractionPending) {
        try {
          await enqueueIngestPipeline({ ingestRequestId: existing.id, traceId: httpTraceId });
          ingestLog('info', 'ingest.duplicate_reenqueued', {
            httpTraceId,
            ingestId: existing.id,
          });
        } catch (enqueueErr) {
          const msg = (enqueueErr as Error).message?.slice(0, 200) ?? '';
          if (/already exists|JobId/i.test(msg)) {
            ingestLog('info', 'ingest.duplicate_job_already_queued', {
              httpTraceId,
              ingestId: existing.id,
            });
          } else {
            ingestLog('warn', 'ingest.duplicate_reenqueue_failed', {
              httpTraceId,
              ingestId: existing.id,
              message: msg,
            });
            setImmediate(() => {
              void runProgressiveIngestPipeline(admin, existing.id, httpTraceId).catch((err) => {
                logger.error({ err, ingestId: existing.id }, 'ingest.background_pipeline_failed');
              });
            });
          }
        }
      }

      ingestLog('info', 'ingest.duplicate_response', {
        httpTraceId,
        ingestId: existing.id,
        extractionSource,
        extractionStatus,
        productCount: products.length,
        priorTraceId: priorTraceId ?? null,
        extractionPending,
      });

      const statusOut =
        rowStatus === 'processing' ? 'processing' : rowStatus === 'ready_for_review' ? 'ready_for_review' : 'draft';

      res.json({
        ingestId: existing.id,
        sourceUrl: ir?.source_url ?? sourceUrl,
        platform: ir?.platform ?? platform,
        videoTitle: ir?.video_title ?? undefined,
        thumbnail: ir?.thumbnail ?? undefined,
        stashScore: ir?.stash_score ?? 4.5,
        products,
        status: statusOut,
        extractionPending,
        extractionSource,
        extractionDurationMs,
        traceId: priorTraceId ?? httpTraceId,
        extractionStatus,
        extractionError: extractionError ?? null,
        pipelineMeta: pipelineMeta ?? null,
      });
      return;
    }

    const customTitle = String(body.video_title ?? body.videoTitle ?? '').trim();
    const videoTitle =
      customTitle.slice(0, 200) || (platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel');

    const initialStatus = productAcquisition === 'manual' ? 'review_required' : 'processing';

    const { data: ingestRow, error: insErr } = await admin
      .from('ingest_requests')
      .insert({
        user_id: user.id,
        source_url: canonicalUrl,
        platform,
        status: initialStatus,
        stash_score: 4.5,
        video_title: videoTitle,
        thumbnail,
      })
      .select('id')
      .single();

    if (insErr || !ingestRow) {
      logger.error({ err: insErr }, 'ingest.insert_failed');
      res.status(500).json({ error: 'Could not create ingest request', detail: insErr?.message });
      return;
    }

    const ingestId = ingestRow.id as string;

    try {
      const { ensureCollectionForIngest } = await import('./collection/ingestBridge');
      const collectionId = await ensureCollectionForIngest(admin, {
        user: {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata as Record<string, unknown>,
        },
        ingestId,
        sourceUrl: canonicalUrl,
        platform,
        title: videoTitle,
        thumbnailUrl: thumbnail,
        originType: platform === 'instagram' ? 'import_instagram' : 'url_ingest',
        qualityScore: 4.5,
        startProcessing: productAcquisition !== 'manual',
      });
      ingestLog('info', 'ingest.collection_linked', {
        httpTraceId,
        ingestId,
        collectionId,
        productAcquisition,
      });
    } catch (collErr) {
      logger.error({ err: collErr, ingestId }, 'ingest.collection_create_failed');
      res.status(500).json({
        error: 'Could not create collection',
        detail: (collErr as Error).message,
      });
      return;
    }

    ingestLog('info', 'ingest.created_row', {
      httpTraceId,
      ingestId,
      userId: user.id,
      platform,
      sourceHost: parsed.hostname,
      productAcquisition,
    });

    if (productAcquisition === 'manual') {
      res.json({
        ingestId,
        sourceUrl: canonicalUrl,
        platform,
        videoTitle,
        thumbnail: thumbnail ?? undefined,
        stashScore: 4.5,
        products: [],
        status: 'review_required',
        extractionPending: false,
        extractionSource: 'manual_deferred',
        extractionDurationMs: 0,
        traceId: httpTraceId,
        extractionStatus: undefined,
        extractionError: null,
        pipelineMeta: { productAcquisition: 'manual' },
      });
      return;
    }

    try {
      await enqueueIngestPipeline({ ingestRequestId: ingestId, traceId: httpTraceId });
      ingestLog('info', 'ingest.enqueued_bullmq', {
        httpTraceId,
        ingestId,
        platform,
      });
    } catch (enqueueErr) {
      ingestLog('warn', 'ingest.bullmq_enqueue_failed_fallback', {
        httpTraceId,
        ingestId,
        message: (enqueueErr as Error).message?.slice(0, 200),
      });
      setImmediate(() => {
        void runProgressiveIngestPipeline(admin, ingestId, httpTraceId).catch((err) => {
          logger.error({ err, ingestId }, 'ingest.background_pipeline_failed');
        });
      });
    }

    res.json({
      ingestId,
      sourceUrl: canonicalUrl,
      platform,
      videoTitle,
      thumbnail: thumbnail ?? undefined,
      stashScore: 4.5,
      products: [],
      status: 'processing',
      extractionPending: true,
      extractionSource: 'queued',
      extractionDurationMs: 0,
      traceId: httpTraceId,
      extractionStatus: undefined,
      extractionError: null,
      pipelineMeta: { productAcquisition: 'automatic' },
    });
  } catch (e) {
    ingestLog('error', 'ingest.unhandled', {
      message: (e as Error).message?.slice(0, 400) ?? 'unknown',
    });
    logger.error(e);
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
});

if (getEnv('INGEST_WORKER_EMBEDDED') !== 'false') {
  void (async () => {
    try {
      const worker = await startEmbeddedIngestPipelineWorker();
      if (worker) logger.info('embedded ingest-pipeline worker started');
    } catch (e) {
      logger.warn({ err: e }, 'embedded ingest worker failed to start — use npm run worker or fallback path');
    }
    try {
      const { resolveRedisAvailability, shouldBypassBullmqEnqueue } = await import(
        './workers/redisConnection'
      );
      const available = await resolveRedisAvailability();
      if (shouldBypassBullmqEnqueue(available)) {
        logger.info('embedded product-resolve worker skipped — redis unavailable');
        return;
      }
      startProductResolveWorker(createSupabaseAdmin());
      logger.info('embedded product-resolve worker started');
      const { startProductAiReviewWorker } = await import('./ai-review/jobs/productAiReviewQueue');
      startProductAiReviewWorker(createSupabaseAdmin());
      logger.info('embedded product-ai-review worker started');
    } catch (e) {
      logger.warn({ err: e }, 'embedded product-resolve worker failed to start');
    }
  })();
}

app.listen(PORT, HOST, () => {
  logger.info({ PORT, HOST }, 'mystash-backend listening');
});