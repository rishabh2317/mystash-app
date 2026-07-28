/**
 * Queued extraction: cache lookup, YouTube unified multimodal path, Instagram legacy path,
 * affiliate wrap, and persistence. Intended for `process-extraction-queue` worker.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractYouTubeVideoId } from './detect';
import type { ExtractionPipelineResult } from './extractionTypes';
import { buildDegradedPlaceholder, extractProductsFromUrl } from './extraction';
import { ingestLog } from './ingestLog';
import { runUnifiedYoutubeExtraction } from './pipelineUnified';
import type { PipelineCtx } from './pipelineVision';
import { wrapAffiliateDestination } from './affiliate';
import { gatherYoutubeContext } from './youtubeContext';
import { getEnv } from '../env';
import { moderateTextBundle, moderateYoutubeContent } from './moderation';
import { verifyProductsWithGoogleSearch } from './googleVerify';
import { stageLog } from '../stageLog';

const PIPELINE_VERSION = getEnv('EXTRACTION_PIPELINE_VERSION') ?? 'v4-backend-unified';

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildContentCacheHash(parts: {
  platform: string;
  externalKey: string;
  transcript: string;
}): Promise<string> {
  const th = await sha256Hex(parts.transcript.slice(0, 80_000));
  return sha256Hex(`${PIPELINE_VERSION}|${parts.platform}|${parts.externalKey}|${th}`);
}

export type ExtractionJobRow = {
  id: string;
  ingest_request_id: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
};

async function readCachedExtraction(
  admin: SupabaseClient,
  hash: string,
): Promise<ExtractionPipelineResult | null> {
  const { data, error } = await admin.from('extraction_cache').select('payload, hit_count').eq('content_hash', hash).maybeSingle();
  if (error || !data?.payload) return null;

  const hit = (data.hit_count as number) ?? 0;
  await admin
    .from('extraction_cache')
    .update({
      hit_count: hit + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('content_hash', hash);

  ingestLog('info', 'extract.cache_hit', { hash: hash.slice(0, 16), hits: hit + 1 });
  return data.payload as ExtractionPipelineResult;
}

async function writeCachedExtraction(
  admin: SupabaseClient,
  params: {
    hash: string;
    platform: string;
    externalVideoKey: string | null;
    transcriptHash: string;
    result: ExtractionPipelineResult;
  },
): Promise<void> {
  await admin.from('extraction_cache').upsert(
    {
      content_hash: params.hash,
      platform: params.platform,
      external_video_key: params.externalVideoKey,
      transcript_hash: params.transcriptHash,
      pipeline_version: PIPELINE_VERSION,
      payload: params.result as unknown as Record<string, unknown>,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'content_hash' },
  );
}

async function computeExtraction(
  admin: SupabaseClient,
  params: {
    sourceUrl: string;
    platform: string;
    videoId: string | null;
    videoTitle: string;
    ingestId: string;
    traceId: string;
    sourceHost: string;
  },
): Promise<{ extraction: ExtractionPipelineResult; youtubeTitle?: string; moderationRejected?: boolean }> {
  const ctx: PipelineCtx = {
    ingestId: params.ingestId,
    traceId: params.traceId,
    platform: params.platform,
    sourceHost: params.sourceHost,
  };

  const verifyCtx = { ingestId: params.ingestId, traceId: params.traceId };

  const openaiConfigured = !!getEnv('OPENAI_API_KEY');

  if (params.platform === 'youtube' && params.videoId && openaiConfigured) {
    const pack = await gatherYoutubeContext(params.videoId, { ingestId: params.ingestId, traceId: params.traceId });
    stageLog(1, 'Transcript Done', { ingestId: params.ingestId, traceId: params.traceId });

    const modPre = await moderateYoutubeContent(admin, pack, ctx);
    if (!modPre.safe) {
      ingestLog('warn', 'moderation.rejected', { ingestId: params.ingestId, traceId: params.traceId });
      return {
        extraction: buildDegradedPlaceholder(
          { sourceUrl: params.sourceUrl, platform: params.platform, videoId: params.videoId },
          { code: 'MODERATION_REJECTED', message: 'Content did not pass automated safety review.' },
        ),
        youtubeTitle: pack.title,
        moderationRejected: true,
      };
    }
    ingestLog('info', 'moderation.pass', { ingestId: params.ingestId, traceId: params.traceId });

    const th = await sha256Hex(pack.transcript.slice(0, 80_000));
    const hash = await buildContentCacheHash({
      platform: 'youtube',
      externalKey: params.videoId,
      transcript: pack.transcript,
    });

    const cached = await readCachedExtraction(admin, hash);
    if (cached) {
      const gv = await verifyProductsWithGoogleSearch(cached.products, verifyCtx);
      stageLog(2, 'Vision Done (cache hit)', { ingestId: params.ingestId });
      stageLog(3, 'Google Search verification done', { ingestId: params.ingestId, googleCse: gv.usedGoogleCse });

      const meta = {
        ...cached.pipelineMeta,
        contextSources: [
          ...new Set([
            ...cached.pipelineMeta.contextSources,
            'extraction_cache_hit',
            ...(gv.usedGoogleCse ? (['google_cse_verify'] as const) : []),
          ]),
        ],
      };

      return {
        extraction: {
          ...cached,
          products: gv.products,
          pipelineMeta: meta,
          durationMs: 0,
        },
        youtubeTitle: pack.title,
      };
    }

    const unified = await runUnifiedYoutubeExtraction(admin, pack, ctx);
    if ('products' in unified) {
      stageLog(2, 'Vision Done', { ingestId: params.ingestId });

      const gv = await verifyProductsWithGoogleSearch(unified.products, verifyCtx);
      stageLog(3, 'Google Search verification done', { ingestId: params.ingestId, googleCse: gv.usedGoogleCse });

      const merged: ExtractionPipelineResult = {
        ...unified,
        products: gv.products,
        pipelineMeta: {
          ...unified.pipelineMeta,
          contextSources: [
            ...new Set([
              ...unified.pipelineMeta.contextSources,
              ...(gv.usedGoogleCse ? (['google_cse_verify'] as const) : []),
            ]),
          ],
        },
      };

      await writeCachedExtraction(admin, {
        hash,
        platform: 'youtube',
        externalVideoKey: params.videoId,
        transcriptHash: th,
        result: merged,
      });
      return { extraction: merged, youtubeTitle: pack.title };
    }

    ingestLog('warn', 'extract.unified_failed', {
      ingestId: params.ingestId,
      code: unified.code,
      message: unified.message,
    });

    return {
      extraction: buildDegradedPlaceholder(
        { sourceUrl: params.sourceUrl, platform: params.platform, videoId: params.videoId },
        {
          code: unified.code,
          message: unified.message,
        },
      ),
      youtubeTitle: pack.title,
    };
  }

  if (!openaiConfigured) {
    return {
      extraction: buildDegradedPlaceholder(
        { sourceUrl: params.sourceUrl, platform: params.platform, videoId: params.videoId },
        {
          code: 'OPENAI_NOT_CONFIGURED',
          message: 'OPENAI_API_KEY is not set on this deployment.',
        },
      ),
    };
  }

  /** Instagram / YouTube without unified */
  const legacyCtx = {
    ingestId: params.ingestId,
    traceId: params.traceId,
    platform: params.platform,
    sourceHost: params.sourceHost,
  };

  if (params.platform === 'instagram') {
    const trHash = await sha256Hex(params.sourceUrl);
    const hash = await sha256Hex(`${PIPELINE_VERSION}|instagram|${params.sourceUrl}|${trHash}`);
    const cached = await readCachedExtraction(admin, hash);
    if (cached) {
      stageLog(1, 'Transcript Done (cache hit)', { ingestId: params.ingestId });
      const gv = await verifyProductsWithGoogleSearch(cached.products, verifyCtx);
      stageLog(2, 'Vision Done (cache hit)', { ingestId: params.ingestId });
      stageLog(3, 'Google Search verification done', { ingestId: params.ingestId, googleCse: gv.usedGoogleCse });
      const meta = {
        ...cached.pipelineMeta,
        contextSources: [
          ...new Set([
            ...cached.pipelineMeta.contextSources,
            'extraction_cache_hit',
            ...(gv.usedGoogleCse ? (['google_cse_verify'] as const) : []),
          ]),
        ],
      };
      return { extraction: { ...cached, products: gv.products, pipelineMeta: meta, durationMs: 0 } };
    }

    stageLog(1, 'Transcript Done', { ingestId: params.ingestId });

    const result = await extractProductsFromUrl(
      {
        sourceUrl: params.sourceUrl,
        platform: params.platform,
        videoId: params.videoId,
        videoTitle: params.videoTitle,
      },
      legacyCtx,
      admin,
    );

    if (openaiConfigured && result.extractionStatus === 'ok') {
      const mod = await moderateTextBundle(admin, ctx, {
        sourceUrl: params.sourceUrl,
        platform: 'instagram',
        blob: result.products.map((p) => p.name).join('; '),
      });
      if (!mod.safe) {
        ingestLog('warn', 'moderation.rejected', { ingestId: params.ingestId, traceId: params.traceId });
        return {
          extraction: buildDegradedPlaceholder(
            { sourceUrl: params.sourceUrl, platform: params.platform, videoId: params.videoId },
            { code: 'MODERATION_REJECTED', message: 'Content did not pass automated safety review.' },
          ),
          moderationRejected: true,
        };
      }
      ingestLog('info', 'moderation.pass', { ingestId: params.ingestId, traceId: params.traceId });
    }
    stageLog(2, 'Vision Done', { ingestId: params.ingestId });

    let final: ExtractionPipelineResult = result;
    if (result.extractionStatus === 'ok') {
      const gv = await verifyProductsWithGoogleSearch(result.products, verifyCtx);
      stageLog(3, 'Google Search verification done', { ingestId: params.ingestId, googleCse: gv.usedGoogleCse });
      final = {
        ...result,
        products: gv.products,
        pipelineMeta: {
          ...result.pipelineMeta,
          contextSources: [
            ...new Set([
              ...result.pipelineMeta.contextSources,
              ...(gv.usedGoogleCse ? (['google_cse_verify'] as const) : []),
            ]),
          ],
        },
      };
      await writeCachedExtraction(admin, {
        hash,
        platform: 'instagram',
        externalVideoKey: null,
        transcriptHash: trHash,
        result: final,
      });
    }

    return { extraction: final };
  }

  stageLog(1, 'Transcript Done', { ingestId: params.ingestId });
  const fallback = await extractProductsFromUrl(
    {
      sourceUrl: params.sourceUrl,
      platform: params.platform,
      videoId: params.videoId,
      videoTitle: params.videoTitle,
    },
    legacyCtx,
    admin,
  );
  stageLog(2, 'Vision Done', { ingestId: params.ingestId });
  return { extraction: fallback };
}

async function persistExtractionResults(
  admin: SupabaseClient,
  params: {
    ingestId: string;
    traceId: string;
    sourceUrl: string;
    platform: string;
    thumbnail: string | null;
    extraction: ExtractionPipelineResult;
    /** Real title from oEmbed when available (avoids duplicate context API calls). */
    videoTitleOverride?: string;
  },
): Promise<void> {
  const {
    products: extracted,
    extractionSource,
    durationMs: extractionDurationMs,
    extractionStatus,
    extractionError,
    pipelineMeta,
  } = params.extraction;

  const draftRows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < extracted.length; i++) {
    const p = extracted[i]!;
    const wrapped = await wrapAffiliateDestination(p.merchantUrl, {
      ingestId: params.ingestId,
      traceId: params.traceId,
      index: i,
    });
    draftRows.push({
      ingest_request_id: params.ingestId,
      external_id: p.externalId,
      name: p.name,
      price: p.price,
      currency: p.currency,
      image: p.image,
      affiliate_url: wrapped.affiliateUrl,
      provider: wrapped.provider,
      confidence: p.confidence,
    });
  }

  if (draftRows.length > 0) {
    const { error: insErr } = await admin.from('ingest_draft_products').insert(draftRows);
    if (insErr) {
      ingestLog('error', 'persist.draft_products_insert_failed', {
        ingestId: params.ingestId,
        message: insErr.message,
        code: insErr.code,
      });
      throw new Error(`Could not save draft products: ${insErr.message}`);
    }
  }

  await admin.from('ingest_extractions').insert({
    ingest_request_id: params.ingestId,
    payload: {
      model: 'queuedExtractionExecutor',
      count: extracted.length,
      extractionSource,
      extractionStatus,
      extractionError: extractionError ?? null,
      pipelineMeta,
      durationMs: extractionDurationMs,
      traceId: params.traceId,
      pipelineVersion: PIPELINE_VERSION,
    },
  });

  /** Do not replace a curator-provided title with the auto-detected YouTube title. */
  const PLACEHOLDER_INGEST_TITLES = new Set(['YouTube Short', 'Instagram Reel', 'Video']);
  let videoTitlePatch: { video_title: string } | Record<string, never> = {};
  const override = params.videoTitleOverride?.trim();
  if (override) {
    const { data: titleRow } = await admin
      .from('ingest_requests')
      .select('video_title')
      .eq('id', params.ingestId)
      .maybeSingle();
    const cur = typeof titleRow?.video_title === 'string' ? titleRow.video_title.trim() : '';
    if (!cur || PLACEHOLDER_INGEST_TITLES.has(cur)) {
      videoTitlePatch = { video_title: override };
    }
  }

  await admin
    .from('ingest_requests')
    .update({
      status: 'ready_for_review',
      updated_at: new Date().toISOString(),
      ...(params.thumbnail ? { thumbnail: params.thumbnail } : {}),
      ...videoTitlePatch,
    })
    .eq('id', params.ingestId);
}

function backoffMsForAttempt(attempts: number): number {
  const base = Math.min(120_000, 3000 * 2 ** Math.min(attempts, 7));
  return base + Math.floor(Math.random() * 1500);
}

export async function runOneExtractionJob(
  admin: SupabaseClient,
  job: ExtractionJobRow,
): Promise<{ outcome: 'completed' | 'requeued' | 'dead_letter' }> {
  const traceId =
    typeof job.payload.trace_id === 'string' ? job.payload.trace_id : crypto.randomUUID();

  const { data: ingest, error: ingErr } = await admin
    .from('ingest_requests')
    .select('id, source_url, platform, video_title, thumbnail, stash_score')
    .eq('id', job.ingest_request_id)
    .maybeSingle();

  if (ingErr || !ingest) {
    ingestLog('error', 'extract.job_missing_ingest', { jobId: job.id, err: ingErr?.message });
    await admin
      .from('extraction_jobs')
      .update({
        status: 'failed',
        locked_at: null,
        locked_by: null,
        last_error: { code: 'INGEST_ROW_MISSING' },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return { outcome: 'dead_letter' };
  }

  const sourceUrl = ingest.source_url as string;
  const platform = ingest.platform as string;
  const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
  const videoTitle = (ingest.video_title as string) || 'Video';
  const thumbnail = (ingest.thumbnail as string) || null;
  const sourceHost = (() => {
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return 'unknown';
    }
  })();

  ingestLog('info', 'extract.job_start', {
    jobId: job.id,
    ingestId: job.ingest_request_id,
    traceId,
    attempt: job.attempts,
    platform,
  });

  let extraction: ExtractionPipelineResult;
  let youtubeTitle: string | undefined;
  let moderationRejected = false;
  try {
    const computed = await computeExtraction(admin, {
      sourceUrl,
      platform,
      videoId: ytId,
      videoTitle,
      ingestId: job.ingest_request_id,
      traceId,
      sourceHost,
    });
    extraction = computed.extraction;
    youtubeTitle = computed.youtubeTitle;
    moderationRejected = computed.moderationRejected === true;
  } catch (e) {
    const msg = (e as Error).message ?? 'unknown';
    ingestLog('error', 'extract.job_exception', { jobId: job.id, message: msg.slice(0, 300) });

    if (job.attempts >= job.max_attempts) {
      extraction = buildDegradedPlaceholder(
        { sourceUrl, platform, videoId: ytId },
        { code: 'EXTRACTION_EXCEPTION', message: msg.slice(0, 200) },
      );
      await persistExtractionResults(admin, {
        ingestId: job.ingest_request_id,
        traceId,
        sourceUrl,
        platform,
        thumbnail,
        extraction,
        videoTitleOverride: undefined,
      });
      await admin
        .from('extraction_jobs')
        .update({
          status: 'dead_letter',
          locked_at: null,
          locked_by: null,
          last_error: { code: 'EXCEPTION', message: msg.slice(0, 400) },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return { outcome: 'dead_letter' };
    }

    await admin
      .from('extraction_jobs')
      .update({
        status: 'pending',
        next_run_at: new Date(Date.now() + backoffMsForAttempt(job.attempts)).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: { code: 'EXCEPTION', message: msg.slice(0, 400) },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return { outcome: 'requeued' };
  }

  if (moderationRejected) {
    await admin
      .from('ingest_requests')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', job.ingest_request_id);
    await admin
      .from('extraction_jobs')
      .update({
        status: 'completed',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    ingestLog('info', 'extract.job_moderation_rejected', {
      jobId: job.id,
      ingestId: job.ingest_request_id,
    });
    return { outcome: 'completed' };
  }

  const errCode = extraction.extractionError?.code ?? '';
  const nonRetryUnified =
    errCode === 'UNIFIED_NO_PRODUCTS' ||
    errCode === 'UNIFIED_FILTERED' ||
    errCode === 'UNIFIED_OPENAI_EMPTY' ||
    errCode === 'UNIFIED_PARSE';
  const degradedOrRate =
    extraction.extractionStatus === 'degraded' &&
    errCode !== 'OPENAI_NOT_CONFIGURED' &&
    !nonRetryUnified &&
    (errCode === 'OPENAI_RATE_LIMIT' ||
      errCode === 'OPENAI_UNAVAILABLE' ||
      errCode.startsWith('UNIFIED') ||
      errCode === 'OPENAI_HTTP_ERROR');

  /** Retry transient-ish failures if attempts remain */
  if (degradedOrRate && job.attempts < job.max_attempts) {
    await admin
      .from('extraction_jobs')
      .update({
        status: 'pending',
        next_run_at: new Date(Date.now() + backoffMsForAttempt(job.attempts)).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: extraction.extractionError ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    ingestLog('warn', 'extract.job_requeue_degraded', {
      jobId: job.id,
      code: extraction.extractionError?.code,
      attempt: job.attempts,
    });
    return { outcome: 'requeued' };
  }

  await persistExtractionResults(admin, {
    ingestId: job.ingest_request_id,
    traceId,
    sourceUrl,
    platform,
    thumbnail,
    extraction,
    videoTitleOverride: youtubeTitle,
  });

  await admin
    .from('extraction_jobs')
    .update({
      status: 'completed',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  ingestLog('info', 'extract.job_complete', {
    jobId: job.id,
    ingestId: job.ingest_request_id,
    extractionStatus: extraction.extractionStatus,
  });

  return { outcome: 'completed' };
}

/** Background ingest without `extraction_jobs` (Express worker). */
export async function runBackendIngestPipeline(
  admin: SupabaseClient,
  ingestRequestId: string,
  traceId: string,
): Promise<void> {
  const { data: ingest, error: ingErr } = await admin
    .from('ingest_requests')
    .select('id, source_url, platform, video_title, thumbnail, stash_score')
    .eq('id', ingestRequestId)
    .maybeSingle();

  if (ingErr || !ingest) {
    ingestLog('error', 'backend.ingest_missing', { ingestRequestId, err: ingErr?.message });
    return;
  }

  const sourceUrl = ingest.source_url as string;
  const platform = ingest.platform as string;
  const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
  const videoTitle = (ingest.video_title as string) || 'Video';
  const thumbnail = (ingest.thumbnail as string) || null;
  const sourceHost = (() => {
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return 'unknown';
    }
  })();

  try {
    const computed = await computeExtraction(admin, {
      sourceUrl,
      platform,
      videoId: ytId,
      videoTitle,
      ingestId: ingestRequestId,
      traceId,
      sourceHost,
    });

    if (computed.moderationRejected) {
      await admin
        .from('ingest_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', ingestRequestId);
      ingestLog('info', 'backend.ingest_moderation_rejected', { ingestRequestId });
      return;
    }

    await persistExtractionResults(admin, {
      ingestId: ingestRequestId,
      traceId,
      sourceUrl,
      platform,
      thumbnail,
      extraction: computed.extraction,
      videoTitleOverride: computed.youtubeTitle,
    });
    ingestLog('info', 'backend.ingest_complete', { ingestRequestId });
  } catch (e) {
    const msg = (e as Error).message ?? 'unknown';
    ingestLog('error', 'backend.ingest_exception', { ingestRequestId, message: msg.slice(0, 400) });
    await admin
      .from('ingest_requests')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ingestRequestId);
  }
}
