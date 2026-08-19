/**
 * Queued extraction: cache lookup, YouTube unified multimodal path, Instagram legacy path,
 * affiliate wrap, and persistence. Intended for `process-extraction-queue` worker.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { extractYouTubeVideoId } from './detect.ts';
import type { ExtractionPipelineResult } from './extractionTypes.ts';
import { buildDegradedPlaceholder, extractProductsFromUrl } from './extraction.ts';
import { ingestLog } from './ingestLog.ts';
import { runUnifiedYoutubeExtraction } from './pipelineUnified.ts';
import type { PipelineCtx } from './pipelineVision.ts';
import { wrapAffiliateDestination } from './affiliate.ts';
import { gatherYoutubeContext } from './youtubeContext.ts';

const PIPELINE_VERSION =
  Deno.env.get('EXTRACTION_PIPELINE_VERSION') ?? 'v4-youtube-metadata';
const YOUTUBE_CONTEXT_VERSION = 'youtube-metadata-v2';

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
  description?: string;
}): Promise<string> {
  const th = await sha256Hex(parts.transcript.slice(0, 80_000));
  const dh = await sha256Hex((parts.description ?? '').slice(0, 20_000));
  return sha256Hex(
    `${PIPELINE_VERSION}|${YOUTUBE_CONTEXT_VERSION}|${parts.platform}|${parts.externalKey}|${th}|${dh}`,
  );
}

export type ExtractionJobRow = {
  id: string;
  ingest_request_id: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
};

type YoutubeMetadata = {
  title: string;
  description: string;
  descriptionSource: string;
  creator: string;
  thumbnailUrl: string | null;
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
): Promise<{ extraction: ExtractionPipelineResult; youtubeMetadata?: YoutubeMetadata }> {
  const ctx: PipelineCtx = {
    ingestId: params.ingestId,
    traceId: params.traceId,
    platform: params.platform,
    sourceHost: params.sourceHost,
  };

  const geminiKey = Deno.env.get('GEMINI_API_KEY');

  if (params.platform === 'youtube' && params.videoId && geminiKey) {
    const pack = await gatherYoutubeContext(params.videoId, { ingestId: params.ingestId, traceId: params.traceId });
    const youtubeMetadata: YoutubeMetadata = {
      title: pack.title,
      description: pack.description,
      descriptionSource: pack.descriptionSource,
      creator: pack.authorName,
      thumbnailUrl: pack.thumbnailUrl,
    };
    const { error: metadataPersistError } = await admin
      .from('ingest_requests')
      .update({
        video_description: youtubeMetadata.description,
        video_description_source: youtubeMetadata.descriptionSource,
        video_creator: youtubeMetadata.creator,
        ...(youtubeMetadata.thumbnailUrl
          ? { thumbnail: youtubeMetadata.thumbnailUrl }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.ingestId);
    if (metadataPersistError) {
      ingestLog('warn', 'metadata.persist_failed', {
        ingestId: params.ingestId,
        traceId: params.traceId,
        descriptionLength: youtubeMetadata.description.length,
        descriptionSource: youtubeMetadata.descriptionSource,
        message: metadataPersistError.message,
      });
    }
    const th = await sha256Hex(pack.transcript.slice(0, 80_000));
    const hash = await buildContentCacheHash({
      platform: 'youtube',
      externalKey: params.videoId,
      transcript: pack.transcript,
      description: pack.description,
    });

    const cached = await readCachedExtraction(admin, hash);
    if (cached) {
      const meta = {
        ...cached.pipelineMeta,
        contextSources: [...new Set([...cached.pipelineMeta.contextSources, 'extraction_cache_hit'])],
      };
      return {
        extraction: {
          ...cached,
          pipelineMeta: meta,
          durationMs: 0,
        },
        youtubeMetadata,
      };
    }

    const unified = await runUnifiedYoutubeExtraction(admin, pack, geminiKey, ctx);
    if ('products' in unified) {
      await writeCachedExtraction(admin, {
        hash,
        platform: 'youtube',
        externalVideoKey: params.videoId,
        transcriptHash: th,
        result: unified,
      });
      return { extraction: unified, youtubeMetadata };
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
      youtubeMetadata,
    };
  }

  if (!geminiKey) {
    return {
      extraction: buildDegradedPlaceholder(
        { sourceUrl: params.sourceUrl, platform: params.platform, videoId: params.videoId },
        {
          code: 'GEMINI_NOT_CONFIGURED',
          message: 'GEMINI_API_KEY is not set on this deployment.',
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
      const meta = {
        ...cached.pipelineMeta,
        contextSources: [...new Set([...cached.pipelineMeta.contextSources, 'extraction_cache_hit'])],
      };
      return { extraction: { ...cached, pipelineMeta: meta, durationMs: 0 } };
    }

    const result = await extractProductsFromUrl(
      {
        sourceUrl: params.sourceUrl,
        platform: params.platform,
        videoId: params.videoId,
        videoTitle: params.videoTitle,
      },
      legacyCtx,
    );

    if (result.extractionStatus === 'ok') {
      await writeCachedExtraction(admin, {
        hash,
        platform: 'instagram',
        externalVideoKey: null,
        transcriptHash: trHash,
        result,
      });
    }

    return { extraction: result };
  }

  return {
    extraction: await extractProductsFromUrl(
      {
        sourceUrl: params.sourceUrl,
        platform: params.platform,
        videoId: params.videoId,
        videoTitle: params.videoTitle,
      },
      legacyCtx,
    ),
  };
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
    youtubeMetadata?: YoutubeMetadata;
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
  const override = params.youtubeMetadata?.title.trim();
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
      status: 'draft',
      updated_at: new Date().toISOString(),
      ...(params.youtubeMetadata?.thumbnailUrl || params.thumbnail
        ? { thumbnail: params.youtubeMetadata?.thumbnailUrl ?? params.thumbnail }
        : {}),
      ...(params.youtubeMetadata
        ? {
            video_description: params.youtubeMetadata.description,
            video_description_source: params.youtubeMetadata.descriptionSource,
            video_creator: params.youtubeMetadata.creator,
          }
        : {}),
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
  let youtubeMetadata: YoutubeMetadata | undefined;
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
    youtubeMetadata = computed.youtubeMetadata;
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
        youtubeMetadata: undefined,
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

  const errCode = extraction.extractionError?.code ?? '';
  const nonRetryUnified =
    errCode === 'UNIFIED_NO_PRODUCTS' ||
    errCode === 'UNIFIED_FILTERED' ||
    errCode === 'UNIFIED_EMPTY' ||
    errCode === 'UNIFIED_PARSE';
  const degradedOrRate =
    extraction.extractionStatus === 'degraded' &&
    errCode !== 'GEMINI_NOT_CONFIGURED' &&
    !nonRetryUnified &&
    (errCode === 'GEMINI_RATE_LIMIT' ||
      errCode === 'GEMINI_UNAVAILABLE' ||
      errCode.startsWith('UNIFIED') ||
      errCode === 'GEMINI_HTTP_ERROR');

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
    youtubeMetadata,
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
