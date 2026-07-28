import { Buffer } from 'node:buffer';
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { detectPlatform, extractYouTubeVideoId } from './pipeline/detect';
import { runBackendIngestPipeline } from './pipeline/extractionExecutor';
import { ingestLog } from './pipeline/ingestLog';
import { createManualIngest } from './manualIngest';
import { createSupabaseAdmin, createSupabaseUserClient } from './supabase';
import { handlePublishIngest } from './publish';
import { logger } from './logger';

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
    if (platform === 'unknown') {
      res.status(400).json({ error: 'Only YouTube and Instagram URLs are supported for the reel' });
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

    const body = req.body as { source_url?: string; video_title?: string; videoTitle?: string };
    const sourceUrl = (body.source_url ?? '').trim();
    if (!sourceUrl) {
      res.status(400).json({ error: 'source_url required' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    const platform = detectPlatform(parsed.href);
    if (platform === 'unknown') {
      ingestLog('warn', 'ingest.unsupported_platform', { httpTraceId, sourceHost: parsed.hostname });
      res.status(400).json({ error: 'Only YouTube and Instagram URLs are supported' });
      return;
    }

    ingestLog('info', 'ingest.accepted', {
      httpTraceId,
      userId: user.id,
      platform,
      sourceHost: parsed.hostname,
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from('ingest_requests')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('source_url', sourceUrl)
      .in('status', ['draft', 'processing', 'ready_for_review'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
        .select('external_id, name, price, currency, image, affiliate_url, provider, confidence')
        .eq('ingest_request_id', existing.id);

      const products = (rows ?? []).map((r) => ({
        id: r.external_id,
        name: r.name,
        price: r.price,
        currency: r.currency ?? undefined,
        provider: r.provider ?? 'unknown',
        affiliateUrl: r.affiliate_url,
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

    const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
    const thumbnail =
      platform === 'youtube' && ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;
    const customTitle = String(body.video_title ?? body.videoTitle ?? '').trim();
    const videoTitle =
      customTitle.slice(0, 200) || (platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel');

    const { data: ingestRow, error: insErr } = await admin
      .from('ingest_requests')
      .insert({
        user_id: user.id,
        source_url: sourceUrl,
        platform,
        status: 'processing',
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

    ingestLog('info', 'ingest.created_row', {
      httpTraceId,
      ingestId,
      userId: user.id,
      platform,
      sourceHost: parsed.hostname,
    });

    setImmediate(() => {
      void runBackendIngestPipeline(admin, ingestId, httpTraceId).catch((err) => {
        logger.error({ err, ingestId }, 'ingest.background_pipeline_failed');
      });
    });

    ingestLog('info', 'ingest.enqueued_inline_worker', {
      httpTraceId,
      ingestId,
      platform,
    });

    res.json({
      ingestId,
      sourceUrl,
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
      pipelineMeta: null,
    });
  } catch (e) {
    ingestLog('error', 'ingest.unhandled', {
      message: (e as Error).message?.slice(0, 400) ?? 'unknown',
    });
    logger.error(e);
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
});

app.listen(PORT,HOST, () => {
  logger.info({ PORT, HOST }, 'mystash-backend listening');
});
