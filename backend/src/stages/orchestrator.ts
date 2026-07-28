import type { SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPipelineConfig } from '../config/pipelineConfig';
import { ContextBuilder } from '../context/ContextBuilder';
import type { FrameRef, MediaUnderstandingResult, MultimodalContext, ProductCandidate, ProductEvidence } from '../domain/types';
import { CompositeMediaUnderstanding } from '../media/CompositeMediaUnderstanding';
import {
  extractAdaptiveFrames,
  extractFramesAtTimestamps,
  planStage3Timestamps,
  probeDurationMs,
} from '../media/FrameExtractor';
import { uploadFramesToStorage } from '../media/frameStorage';
import { mergeMediaUnderstanding } from '../media/mergeMediaUnderstanding';
import { GoogleVisionLogoProvider } from '../providers/logo/GoogleVisionLogoProvider';
import { GoogleVisionOcrProvider } from '../providers/ocr/GoogleVisionOcrProvider';
import { OpenAiReasonerProvider } from '../providers/reasoner/OpenAiReasonerProvider';
import { OpenAiSceneProvider } from '../providers/scene/OpenAiSceneProvider';
import { OpenAiVisionProvider } from '../providers/vision/OpenAiVisionProvider';
import { YtDlpVideoProvider } from '../providers/video/YtDlpVideoProvider';
import { ProductRanker } from '../products/ProductRanker';
import { ProductValidator } from '../products/ProductValidator';
import { persistPipelineProducts } from '../products/productPersist';
import { extractYouTubeVideoId } from '../pipeline/detect';
import { gatherYoutubeContext } from '../pipeline/youtubeContext';
import { getVideoExtractionCache, setVideoExtractionCache } from '../services/extractionCache';
import { emitPipelineEvent } from '../services/observability';
import {
  estimateTokenCostUsd,
  recordStageArtifact,
  summarizeProducts,
} from '../services/stageArtifacts';
import { needsStage2Enrichment, stagePass } from './gate';

export type OrchestratorResult = {
  status: 'ready_for_review' | 'review_required' | 'failed' | 'cached';
  finalStage: string;
  productCount: number;
};

async function createPipelineRun(
  admin: SupabaseClient,
  ingestId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('ingest_pipeline_runs')
    .insert({
      ingest_request_id: ingestId,
      stages_completed: [],
      final_stage: 'init',
      status: 'running',
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return data.id as string;
}

async function finalizePipelineRun(
  admin: SupabaseClient,
  runId: string | null,
  params: {
    cacheKey?: string;
    stages: string[];
    finalStage: string;
    status: string;
    durationMs: number;
    modelUsed?: string;
    error?: unknown;
  },
): Promise<void> {
  if (!runId) return;
  await admin
    .from('ingest_pipeline_runs')
    .update({
      cache_key: params.cacheKey ?? null,
      stages_completed: params.stages,
      final_stage: params.finalStage,
      status: params.status,
      duration_ms: params.durationMs,
      model_used: params.modelUsed ?? null,
      error: params.error ? { message: String(params.error).slice(0, 400) } : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

async function reasonValidateRank(
  admin: SupabaseClient,
  ctx: MultimodalContext,
  ingestId: string,
  traceId: string,
  pipelineRunId: string | null,
  stageTag: 's1' | 's2' | 's3',
): Promise<ProductCandidate[]> {
  const reasoner = new OpenAiReasonerProvider(admin);
  const validator = new ProductValidator();
  const ranker = new ProductRanker();

  emitPipelineEvent('context.built', {
    ingestId,
    traceId,
    hasMedia: !!ctx.media,
    transcriptLen: ctx.transcript.length,
    stage: stageTag,
  });

  await recordStageArtifact(admin, {
    ingestId,
    pipelineRunId,
    stage: `context_${stageTag}`,
    provider: 'context-builder',
    payload: {
      inputSummary: {
        platform: ctx.platform,
        externalVideoId: ctx.externalVideoId,
        transcriptLen: ctx.transcript.length,
        transcriptAvailable: ctx.transcript.available,
        hasMedia: !!ctx.media,
        objectCount: ctx.media?.objects.length ?? 0,
        ocrCount: ctx.media?.ocr.length ?? 0,
        logoCount: ctx.media?.logos.length ?? 0,
        scene: ctx.media?.scene?.label ?? null,
        frameCount: ctx.frames.length,
      },
      outputSummary: { pipelineVersion: ctx.pipelineVersion, providerVersion: ctx.providerVersion },
    },
  });

  const reasoned = await reasoner.reason({ context: ctx, ingestId, traceId });
  const tokens = reasoned.meta.tokenUsage?.totalTokens ?? null;
  emitPipelineEvent('reasoning.complete', {
    ingestId,
    traceId,
    rawCount: reasoned.products.length,
    durationMs: reasoned.meta.durationMs,
    tokens: tokens ?? undefined,
    provider: reasoned.meta.provider,
  });

  await recordStageArtifact(admin, {
    ingestId,
    pipelineRunId,
    stage: `reason_${stageTag}`,
    provider: reasoned.meta.provider,
    durationMs: reasoned.meta.durationMs,
    tokenUsage: reasoned.meta.tokenUsage ?? {},
    costUsd: estimateTokenCostUsd(tokens),
    payload: {
      inputSummary: {
        hasMedia: !!ctx.media,
        transcriptLen: ctx.transcript.length,
        title: ctx.metadata.title?.slice(0, 120) ?? null,
      },
      outputSummary: summarizeProducts(reasoned.products),
    },
  });

  const tVal = performance.now();
  const validated = validator.validate(reasoned.products);
  emitPipelineEvent('validate.complete', { ingestId, traceId, count: validated.length });
  await recordStageArtifact(admin, {
    ingestId,
    pipelineRunId,
    stage: `validate_${stageTag}`,
    provider: 'product-validator',
    durationMs: Math.round(performance.now() - tVal),
    payload: {
      inputSummary: summarizeProducts(reasoned.products),
      outputSummary: summarizeProducts(validated),
      dropped: reasoned.products.length - validated.length,
    },
  });

  const tRank = performance.now();
  const ranked = ranker.rank(validated, ctx);
  emitPipelineEvent('rank.complete', { ingestId, traceId, count: ranked.length });
  await recordStageArtifact(admin, {
    ingestId,
    pipelineRunId,
    stage: `rank_${stageTag}`,
    provider: 'product-ranker',
    durationMs: Math.round(performance.now() - tRank),
    payload: {
      inputSummary: summarizeProducts(validated),
      outputSummary: {
        ...summarizeProducts(ranked),
        order: ranked.slice(0, 12).map((p) => p.name),
      },
    },
  });

  return ranked;
}

async function persistFrameRows(
  admin: SupabaseClient,
  params: {
    ingestId: string;
    pipelineRunId: string | null;
    stage: string;
    frames: FrameRef[];
    objectPaths: string[];
    sha256s: string[];
  },
): Promise<void> {
  for (let i = 0; i < params.frames.length; i++) {
    const f = params.frames[i]!;
    await admin.from('ingest_frame_assets').upsert(
      {
        ingest_request_id: params.ingestId,
        pipeline_run_id: params.pipelineRunId,
        stage: params.stage,
        frame_index: f.index,
        timestamp_ms: f.timestampMs,
        storage_path: params.objectPaths[i] ?? f.storagePath,
        sha256: params.sha256s[i] || null,
      },
      { onConflict: 'ingest_request_id,stage,frame_index' },
    );
  }
}

/**
 * Progressive Stage 1 → 2 → 3 orchestrator.
 * Cheapest successful path always preferred.
 */
export async function runProgressiveIngestPipeline(
  admin: SupabaseClient,
  ingestRequestId: string,
  traceId: string,
): Promise<OrchestratorResult> {
  const tAll = performance.now();
  const cfg = getPipelineConfig();
  const stages: string[] = [];
  const builder = new ContextBuilder();
  const pipelineRunId = await createPipelineRun(admin, ingestRequestId);

  emitPipelineEvent('ingest.started', { ingestId: ingestRequestId, traceId });

  const { data: ingest, error: ingErr } = await admin
    .from('ingest_requests')
    .select('id, source_url, platform, video_title, thumbnail')
    .eq('id', ingestRequestId)
    .maybeSingle();

  if (ingErr || !ingest) {
    await finalizePipelineRun(admin, pipelineRunId, {
      stages,
      finalStage: 'init',
      status: 'failed',
      durationMs: Math.round(performance.now() - tAll),
      error: ingErr?.message ?? 'missing ingest',
    });
    await recordStageArtifact(admin, {
      ingestId: ingestRequestId,
      pipelineRunId,
      stage: 'init',
      error: ingErr?.message ?? 'missing ingest',
      payload: { inputSummary: {}, outputSummary: { failed: true } },
    });
    return { status: 'failed', finalStage: 'init', productCount: 0 };
  }

  const sourceUrl = ingest.source_url as string;
  const platform = (ingest.platform as string) || 'youtube';
  const videoId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
  const externalKey = videoId ?? sourceUrl;

  // ---- Cache ----
  if (platform === 'youtube' && videoId) {
    const hit = await getVideoExtractionCache(admin, { platform, externalVideoId: videoId });
    if (hit) {
      emitPipelineEvent('cache.hit', { ingestId: ingestRequestId, cacheKey: hit.cacheKey });
      await recordStageArtifact(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'cache',
        provider: 'video_extraction_cache',
        payload: {
          inputSummary: { cacheKey: hit.cacheKey },
          outputSummary: summarizeProducts(hit.payload.products),
          finalStage: hit.payload.finalStage,
          status: hit.payload.status,
        },
      });
      await persistPipelineProducts(admin, {
        ingestId: ingestRequestId,
        traceId,
        products: hit.payload.products,
        status: hit.payload.status,
        pipelineMeta: {
          transcriptAgent: 'cache',
          contextSources: ['video_extraction_cache'],
          priceAgent: 'cached',
          cacheKey: hit.cacheKey,
        },
        thumbnail: ingest.thumbnail as string | null,
        videoTitle: ingest.video_title as string | undefined,
      });
      await finalizePipelineRun(admin, pipelineRunId, {
        cacheKey: hit.cacheKey,
        stages: ['cache'],
        finalStage: 'cache',
        status: 'cached',
        durationMs: Math.round(performance.now() - tAll),
      });
      emitPipelineEvent('ingest.complete', {
        ingestId: ingestRequestId,
        status: 'cached',
        productCount: hit.payload.products.length,
      });
      return {
        status: 'cached',
        finalStage: 'cache',
        productCount: hit.payload.products.length,
      };
    }
  }

  // ---- Stage 1: metadata + transcript ----
  let title = (ingest.video_title as string) || '';
  let creator = '';
  let thumbnailUrl: string | null = (ingest.thumbnail as string) || null;
  let transcript = '';
  let transcriptSources: string[] = [];

  if (platform === 'youtube' && videoId) {
    const tMeta = performance.now();
    const pack = await gatherYoutubeContext(videoId, { ingestId: ingestRequestId, traceId });
    const metaMs = Math.round(performance.now() - tMeta);
    title = pack.title || title;
    creator = pack.authorName;
    thumbnailUrl = pack.thumbnailUrl ?? thumbnailUrl;
    transcript = pack.transcript;
    transcriptSources = pack.sources;
    stages.push('metadata', 'transcript');
    emitPipelineEvent('metadata.complete', { ingestId: ingestRequestId, titleLen: title.length });
    emitPipelineEvent('transcript.complete', {
      ingestId: ingestRequestId,
      transcriptLen: transcript.length,
      sources: pack.sources.join(','),
    });
    await recordStageArtifact(admin, {
      ingestId: ingestRequestId,
      pipelineRunId,
      stage: 'metadata',
      provider: 'youtube-context',
      durationMs: metaMs,
      payload: {
        inputSummary: { videoId, sourceUrl: sourceUrl.slice(0, 200) },
        outputSummary: {
          title: title.slice(0, 160),
          creator,
          thumbnail: !!thumbnailUrl,
        },
      },
    });
    await recordStageArtifact(admin, {
      ingestId: ingestRequestId,
      pipelineRunId,
      stage: 'transcript',
      provider: 'youtube-context',
      durationMs: metaMs,
      payload: {
        inputSummary: { videoId, sources: transcriptSources },
        outputSummary: {
          length: transcript.length,
          available: transcript.length >= cfg.transcriptMinChars,
          preview: transcript.slice(0, 240),
        },
      },
    });
  } else {
    stages.push('metadata');
    emitPipelineEvent('metadata.complete', { ingestId: ingestRequestId, nonYoutube: true });
    await recordStageArtifact(admin, {
      ingestId: ingestRequestId,
      pipelineRunId,
      stage: 'metadata',
      provider: 'ingest-row',
      payload: {
        inputSummary: { platform, sourceUrl: sourceUrl.slice(0, 200) },
        outputSummary: { title: title.slice(0, 160), nonYoutube: true },
      },
    });
  }

  let ctx = builder.build({
    platform,
    externalVideoId: externalKey,
    sourceUrl,
    metadata: {
      title,
      creator,
      description: '',
      thumbnailUrl,
    },
    transcriptText: transcript,
    media: null,
  });

  let products = await reasonValidateRank(admin, ctx, ingestRequestId, traceId, pipelineRunId, 's1');
  stages.push('reason_s1', 'validate_s1', 'rank_s1');
  let gate = stagePass(products);
  emitPipelineEvent('stage.gate', { ingestId: ingestRequestId, stage: 1, ...gate });
  await recordStageArtifact(admin, {
    ingestId: ingestRequestId,
    pipelineRunId,
    stage: 'gate_s1',
    provider: 'gate',
    payload: { inputSummary: summarizeProducts(products), outputSummary: { ...gate } },
  });

  let finalStage = 'stage1';
  let media: MediaUnderstandingResult | null = null;
  let frames: FrameRef[] = [];
  let workDir: string | null = null;
  let videoLocal: string | null = null;
  let durationMs = 0;

  const mu = new CompositeMediaUnderstanding(
    new OpenAiVisionProvider(admin),
    new GoogleVisionOcrProvider(),
    new GoogleVisionLogoProvider(),
    new OpenAiSceneProvider(admin),
  );
  const videoProvider = new YtDlpVideoProvider();

  // ---- Stage 2 ----
  if (
    needsStage2Enrichment({
      stage1Pass: gate.pass,
      transcriptAvailable: ctx.transcript.available,
      transcriptLength: ctx.transcript.length,
    })
  ) {
    try {
      const tS2 = performance.now();
      workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mystash-ingest-'));
      const downloaded = await videoProvider.download(sourceUrl, workDir);
      videoLocal = downloaded.localPath;
      durationMs = downloaded.durationMs || (await probeDurationMs(videoLocal));

      const frameDir = path.join(workDir, 'frames_s2');
      const extracted = await extractAdaptiveFrames({
        videoPath: videoLocal,
        outDir: frameDir,
        ingestId: ingestRequestId,
      });
      frames = extracted.frames;
      durationMs = extracted.durationMs || durationMs;

      const uploaded = await uploadFramesToStorage(admin, {
        ingestId: ingestRequestId,
        stage: 'stage2',
        frames,
      });
      frames = uploaded.frames;

      await persistFrameRows(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'stage2',
        frames,
        objectPaths: uploaded.objectPaths,
        sha256s: uploaded.sha256s,
      });

      emitPipelineEvent('media_understanding.started', {
        ingestId: ingestRequestId,
        frameCount: frames.length,
      });
      const tMu = performance.now();
      media = await mu.analyze({ frames, ingestId: ingestRequestId, traceId });
      const muMs = Math.round(performance.now() - tMu);
      stages.push('media_understanding_s2');
      emitPipelineEvent('media_understanding.complete', {
        ingestId: ingestRequestId,
        objectCount: media.objects.length,
        durationMs: muMs,
      });

      await recordStageArtifact(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'media_understanding_s2',
        provider: media.providerMeta.vision ?? 'composite-mu',
        durationMs: muMs,
        payload: {
          inputSummary: {
            frameCount: frames.length,
            durationMsVideo: durationMs,
            objectPaths: uploaded.objectPaths.slice(0, 12),
          },
          outputSummary: {
            objects: media.objects.slice(0, 20).map((o) => ({
              label: o.label,
              confidence: o.confidence,
              frameIndex: o.frameIndex,
            })),
            logos: media.logos.slice(0, 10),
            ocrPreview: media.ocr.slice(0, 5).map((o) => o.text.slice(0, 80)),
            scene: media.scene,
            activities: media.activities,
            providerMeta: media.providerMeta,
          },
        },
      });

      ctx = builder.build({
        platform,
        externalVideoId: externalKey,
        sourceUrl,
        metadata: ctx.metadata,
        transcriptText: transcript,
        media,
      });

      products = await reasonValidateRank(admin, ctx, ingestRequestId, traceId, pipelineRunId, 's2');
      stages.push('reason_s2', 'validate_s2', 'rank_s2');
      gate = stagePass(products);
      finalStage = 'stage2';
      emitPipelineEvent('stage.gate', { ingestId: ingestRequestId, stage: 2, ...gate });
      await recordStageArtifact(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'gate_s2',
        provider: 'gate',
        durationMs: Math.round(performance.now() - tS2),
        payload: { inputSummary: summarizeProducts(products), outputSummary: { ...gate } },
      });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 200);
      emitPipelineEvent('stage.gate', {
        ingestId: ingestRequestId,
        stage: 2,
        pass: false,
        error: msg,
      });
      await recordStageArtifact(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'media_understanding_s2',
        error: msg,
        payload: { inputSummary: { sourceUrl: sourceUrl.slice(0, 200) }, outputSummary: { failed: true } },
      });
      gate = { pass: false, productCount: products.length, maxConfidence: 0, reason: 'stage2_error' };
    }
  }

  // ---- Stage 3 ----
  if (!gate.pass && videoLocal) {
    try {
      const tS3 = performance.now();
      const maxTotal = cfg.stage3MaxFrames;
      const missingTs = planStage3Timestamps(durationMs || 15_000, frames, maxTotal);
      let newFrames: FrameRef[] = [];
      if (missingTs.length > 0 && workDir) {
        const more = await extractFramesAtTimestamps({
          videoPath: videoLocal,
          timestampsMs: missingTs,
          outDir: path.join(workDir, 'frames_s3'),
          ingestId: ingestRequestId,
        });
        const offset = frames.length;
        const remapped = more.map((f, i) => ({ ...f, index: offset + i }));
        const uploaded = await uploadFramesToStorage(admin, {
          ingestId: ingestRequestId,
          stage: 'stage3',
          frames: remapped,
        });
        newFrames = uploaded.frames;
        frames = [...frames, ...newFrames];
        await persistFrameRows(admin, {
          ingestId: ingestRequestId,
          pipelineRunId,
          stage: 'stage3',
          frames: newFrames,
          objectPaths: uploaded.objectPaths,
          sha256s: uploaded.sha256s,
        });
      }

      if (newFrames.length > 0) {
        const tMu = performance.now();
        const incremental = await mu.analyze({
          frames: newFrames,
          ingestId: ingestRequestId,
          traceId,
        });
        media = mergeMediaUnderstanding(media, incremental);
        stages.push('media_understanding_s3');
        await recordStageArtifact(admin, {
          ingestId: ingestRequestId,
          pipelineRunId,
          stage: 'media_understanding_s3',
          provider: incremental.providerMeta.vision ?? 'composite-mu',
          durationMs: Math.round(performance.now() - tMu),
          payload: {
            inputSummary: { newFrameCount: newFrames.length, reusedPrior: !!media },
            outputSummary: {
              objects: incremental.objects.slice(0, 20).map((o) => o.label),
              logos: incremental.logos.slice(0, 10).map((l) => l.description),
              scene: media?.scene,
              mergedObjectCount: media?.objects.length ?? 0,
            },
          },
        });
      } else if (media) {
        stages.push('media_understanding_s3_reuse');
        await recordStageArtifact(admin, {
          ingestId: ingestRequestId,
          pipelineRunId,
          stage: 'media_understanding_s3',
          provider: 'reuse',
          payload: {
            inputSummary: { newFrameCount: 0 },
            outputSummary: { reused: true, objectCount: media.objects.length },
          },
        });
      }

      ctx = builder.build({
        platform,
        externalVideoId: externalKey,
        sourceUrl,
        metadata: ctx.metadata,
        transcriptText: transcript,
        media,
      });

      products = await reasonValidateRank(admin, ctx, ingestRequestId, traceId, pipelineRunId, 's3');
      stages.push('reason_s3', 'validate_s3', 'rank_s3');
      gate = stagePass(products);
      finalStage = 'stage3';
      emitPipelineEvent('stage.gate', { ingestId: ingestRequestId, stage: 3, ...gate });
      await recordStageArtifact(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'gate_s3',
        provider: 'gate',
        durationMs: Math.round(performance.now() - tS3),
        payload: { inputSummary: summarizeProducts(products), outputSummary: { ...gate } },
      });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 200);
      emitPipelineEvent('stage.gate', {
        ingestId: ingestRequestId,
        stage: 3,
        pass: false,
        error: msg,
      });
      await recordStageArtifact(admin, {
        ingestId: ingestRequestId,
        pipelineRunId,
        stage: 'media_understanding_s3',
        error: msg,
        payload: { inputSummary: {}, outputSummary: { failed: true } },
      });
    }
  }

  if (workDir) {
    await videoProvider.cleanup?.(path.join(workDir, 'x'));
  }

  const status: 'ready_for_review' | 'review_required' =
    products.length > 0 ? 'ready_for_review' : 'review_required';

  if (frames.length > 0) {
    const byIndex = new Map(frames.map((f) => [f.index, f]));
    products = products.map((p) => {
      const base: ProductEvidence =
        typeof p.evidence === 'string'
          ? {
              summary: p.evidence,
              frames: frames.slice(0, 3).map((f) => ({
                frameIndex: f.index,
                timestampMs: f.timestampMs,
                storagePath: f.storagePath,
              })),
              frameCount: Math.min(3, frames.length),
              logoHits: [],
              transcriptMentions: false,
              ocrMentions: false,
            }
          : { ...p.evidence };

      const srcFrames =
        base.frames.length > 0
          ? base.frames
          : frames.slice(0, 3).map((f) => ({
              frameIndex: f.index,
              timestampMs: f.timestampMs,
              storagePath: f.storagePath,
            }));

      const enrichedFrames = srcFrames.map((fr) => {
        const hit = byIndex.get(fr.frameIndex);
        return {
          ...fr,
          storagePath: fr.storagePath || hit?.storagePath,
        };
      });

      return {
        ...p,
        evidence: {
          ...base,
          frames: enrichedFrames,
          frameCount: base.frameCount || enrichedFrames.length,
        },
      };
    });
  }

  if (status === 'review_required') {
    emitPipelineEvent('review.required', { ingestId: ingestRequestId, finalStage });
    await recordStageArtifact(admin, {
      ingestId: ingestRequestId,
      pipelineRunId,
      stage: 'review_required',
      provider: 'orchestrator',
      payload: {
        inputSummary: summarizeProducts(products),
        outputSummary: { finalStage, status },
      },
    });
  }

  emitPipelineEvent('catalog.match.complete', {
    ingestId: ingestRequestId,
    matchCount: 0,
    deferred: true,
  });
  await recordStageArtifact(admin, {
    ingestId: ingestRequestId,
    pipelineRunId,
    stage: 'catalog_match',
    provider: 'deferred',
    payload: {
      inputSummary: summarizeProducts(products),
      outputSummary: { deferredUntilPublish: true },
    },
  });

  await persistPipelineProducts(admin, {
    ingestId: ingestRequestId,
    traceId,
    products,
    status,
    pipelineMeta: {
      transcriptAgent: transcript.length >= cfg.transcriptMinChars ? 'youtube_captions' : 'url_only',
      contextSources: [
        'metadata',
        ...(transcript ? (['transcript'] as const) : []),
        ...(media ? (['media_understanding'] as const) : []),
      ],
      priceAgent: 'reasoner',
      finalStage,
      stagesCompleted: stages,
      affiliateDeferred: true,
    },
    thumbnail: thumbnailUrl,
    videoTitle: title || undefined,
  });

  if (platform === 'youtube' && videoId) {
    await setVideoExtractionCache(admin, {
      platform,
      externalVideoId: videoId,
      products,
      finalStage,
      status,
    });
  }

  const durationMsTotal = Math.round(performance.now() - tAll);
  await finalizePipelineRun(admin, pipelineRunId, {
    stages,
    finalStage,
    status,
    durationMs: durationMsTotal,
    modelUsed: cfg.openaiReasonerModel,
  });

  emitPipelineEvent('ingest.complete', {
    ingestId: ingestRequestId,
    status,
    finalStage,
    productCount: products.length,
    durationMs: durationMsTotal,
  });

  return { status, finalStage, productCount: products.length };
}
