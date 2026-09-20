import type { SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPipelineConfig } from '../config/pipelineConfig';
import { ContextBuilder } from '../context/ContextBuilder';
import type {
  FrameRef,
  MediaUnderstandingResult,
  MultimodalContext,
  ProductCandidate,
  ProductEvidence,
} from '../domain/types';
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
import { YtDlpVideoProvider, probeYtDlpJson } from '../providers/video/YtDlpVideoProvider';
import { ProductRanker } from '../products/ProductRanker';
import { ProductValidator } from '../products/ProductValidator';
import { gatherInstagramContext } from '../pipeline/instagramContext';
import { gatherYoutubeContext } from '../pipeline/youtubeContext';
import { getVideoExtractionCache, setVideoExtractionCache } from '../services/extractionCache';
import { emitPipelineEvent } from '../services/observability';
import { needsStage2Enrichment, stagePass } from './gate';

export type VideoSourceMetadata = {
  title: string;
  description: string;
  descriptionSource: string;
  creator: string;
  thumbnailUrl: string | null;
};

export type ProgressiveExtractInput = {
  admin: SupabaseClient;
  sourceUrl: string;
  platform: string;
  externalVideoId: string;
  /** Log / reasoner correlation — contentSourceId or ingestRequestId. Not a user id. */
  correlationId: string;
  traceId: string;
};

export type ProgressiveExtractResult =
  | {
      kind: 'ok';
      products: ProductCandidate[];
      status: 'ready_for_review' | 'review_required' | 'cached';
      finalStage: string;
      cacheHit: boolean;
      metadata: VideoSourceMetadata;
      durationMs: number;
    }
  | {
      kind: 'source_unavailable';
      errorCode: string;
      errorMessage: string;
      availability: 'unavailable' | 'restricted';
      title: string | null;
      durationMs: number;
    };

async function reasonValidateRank(
  admin: SupabaseClient,
  ctx: MultimodalContext,
  correlationId: string,
  traceId: string,
  stageTag: 's1' | 's2' | 's3',
): Promise<ProductCandidate[]> {
  const reasoner = new OpenAiReasonerProvider(admin);
  const validator = new ProductValidator();
  const ranker = new ProductRanker();
  const reasoned = await reasoner.reason({ context: ctx, ingestId: correlationId, traceId });
  emitPipelineEvent('reasoning.complete', {
    ingestId: correlationId,
    traceId,
    rawCount: reasoned.products.length,
    stage: stageTag,
    durationMs: reasoned.meta.durationMs,
    provider: reasoned.meta.provider,
  });
  const validated = validator.validate(reasoned.products);
  const ranked = ranker.rank(validated, ctx);
  emitPipelineEvent('rank.complete', { ingestId: correlationId, traceId, count: ranked.length });
  return ranked;
}

function enrichEvidence(products: ProductCandidate[], frames: FrameRef[]): ProductCandidate[] {
  if (frames.length === 0) return products;
  const byIndex = new Map(frames.map((f) => [f.index, f]));
  return products.map((p) => {
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
    return {
      ...p,
      evidence: {
        ...base,
        frames: srcFrames.map((fr) => ({
          ...fr,
          storagePath: fr.storagePath || byIndex.get(fr.frameIndex)?.storagePath,
        })),
        frameCount: base.frameCount || srcFrames.length,
      },
    };
  });
}

/**
 * Shared progressive extraction used by creator ingest and content-source processing.
 * Returns product candidates only — callers persist to their own tables.
 * Never writes Catalog, ingest-draft, or Bag rows.
 */
export async function runProgressiveExtract(
  params: ProgressiveExtractInput,
): Promise<ProgressiveExtractResult> {
  const tAll = performance.now();
  const { admin, sourceUrl, platform, externalVideoId, correlationId, traceId } = params;
  const cfg = getPipelineConfig();
  const builder = new ContextBuilder();

  const hit = await getVideoExtractionCache(admin, { platform, externalVideoId });
  if (hit) {
    emitPipelineEvent('cache.hit', { ingestId: correlationId, cacheKey: hit.cacheKey });
    const meta = hit.payload.youtubeMetadata;
    return {
      kind: 'ok',
      products: hit.payload.products,
      status: 'cached',
      finalStage: 'cache',
      cacheHit: true,
      metadata: {
        title: meta?.title ?? '',
        description: meta?.description ?? '',
        descriptionSource: meta?.descriptionSource ?? 'cache',
        creator: meta?.creator ?? '',
        thumbnailUrl: meta?.thumbnailUrl ?? null,
      },
      durationMs: Math.round(performance.now() - tAll),
    };
  }
  emitPipelineEvent('cache.miss', { ingestId: correlationId, platform, externalVideoId });

  let title = '';
  let creator = '';
  let description = '';
  let descriptionSource = 'none';
  let thumbnailUrl: string | null = null;
  let transcript = '';

  if (platform === 'youtube') {
    const pack = await gatherYoutubeContext(externalVideoId, {
      ingestId: correlationId,
      traceId,
    });
    if (pack.sourceBlock) {
      return {
        kind: 'source_unavailable',
        errorCode: pack.sourceBlock.code,
        errorMessage: pack.sourceBlock.message,
        availability: pack.sourceBlock.availability,
        title: pack.title || null,
        durationMs: Math.round(performance.now() - tAll),
      };
    }
    title = pack.title || title;
    creator = pack.authorName;
    description = pack.description;
    descriptionSource = pack.descriptionSource;
    thumbnailUrl = pack.thumbnailUrl ?? thumbnailUrl;
    transcript = pack.transcript;
  } else if (platform === 'instagram') {
    const pack = await gatherInstagramContext(sourceUrl, {
      ingestId: correlationId,
      traceId,
      probe: probeYtDlpJson,
    });
    if (pack.availability !== 'available') {
      return {
        kind: 'source_unavailable',
        errorCode: pack.errorCode ?? 'SOURCE_UNAVAILABLE',
        errorMessage:
          pack.errorMessage ??
          'This Instagram Reel could not be loaded. It may be private or restricted.',
        availability: pack.availability,
        title: pack.title || null,
        durationMs: Math.round(performance.now() - tAll),
      };
    }
    title = pack.title || title;
    creator = pack.authorName || creator;
    description = pack.description || description;
    descriptionSource = pack.sources.includes('yt-dlp-json')
      ? 'instagram_caption'
      : pack.sources.includes('oembed')
        ? 'instagram_oembed'
        : descriptionSource;
    thumbnailUrl = pack.thumbnailUrl ?? thumbnailUrl;
    transcript = pack.description;
  }

  let ctx = builder.build({
    platform,
    externalVideoId,
    sourceUrl,
    metadata: { title, creator, description, thumbnailUrl },
    transcriptText: transcript,
    media: null,
  });

  let products = await reasonValidateRank(admin, ctx, correlationId, traceId, 's1');
  let gate = stagePass(products);
  emitPipelineEvent('stage.gate', { ingestId: correlationId, stage: 1, ...gate });

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

  if (
    needsStage2Enrichment({
      stage1Pass: gate.pass,
      transcriptAvailable: ctx.transcript.available,
      transcriptLength: ctx.transcript.length,
    })
  ) {
    try {
      workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mystash-extract-'));
      const downloaded = await videoProvider.download(sourceUrl, workDir);
      videoLocal = downloaded.localPath;
      durationMs = downloaded.durationMs || (await probeDurationMs(videoLocal));
      const extracted = await extractAdaptiveFrames({
        videoPath: videoLocal,
        outDir: path.join(workDir, 'frames_s2'),
        ingestId: correlationId,
      });
      frames = extracted.frames;
      durationMs = extracted.durationMs || durationMs;
      const uploaded = await uploadFramesToStorage(admin, {
        ingestId: correlationId,
        stage: 'stage2',
        frames,
      });
      frames = uploaded.frames;
      media = await mu.analyze({ frames, ingestId: correlationId, traceId });
      ctx = builder.build({
        platform,
        externalVideoId,
        sourceUrl,
        metadata: ctx.metadata,
        transcriptText: transcript,
        media,
      });
      products = await reasonValidateRank(admin, ctx, correlationId, traceId, 's2');
      gate = stagePass(products);
      finalStage = 'stage2';
      emitPipelineEvent('stage.gate', { ingestId: correlationId, stage: 2, ...gate });
    } catch (e) {
      emitPipelineEvent('stage.gate', {
        ingestId: correlationId,
        stage: 2,
        pass: false,
        error: (e as Error).message?.slice(0, 200),
      });
      gate = { pass: false, productCount: products.length, maxConfidence: 0, reason: 'stage2_error' };
    }
  }

  if (!gate.pass && videoLocal) {
    try {
      const maxTotal = cfg.stage3MaxFrames;
      const missingTs = planStage3Timestamps(durationMs || 15_000, frames, maxTotal);
      let newFrames: FrameRef[] = [];
      if (missingTs.length > 0 && workDir) {
        const more = await extractFramesAtTimestamps({
          videoPath: videoLocal,
          timestampsMs: missingTs,
          outDir: path.join(workDir, 'frames_s3'),
          ingestId: correlationId,
        });
        const offset = frames.length;
        const remapped = more.map((f, i) => ({ ...f, index: offset + i }));
        const uploaded = await uploadFramesToStorage(admin, {
          ingestId: correlationId,
          stage: 'stage3',
          frames: remapped,
        });
        newFrames = uploaded.frames;
        frames = [...frames, ...newFrames];
      }
      if (newFrames.length > 0) {
        const incremental = await mu.analyze({
          frames: newFrames,
          ingestId: correlationId,
          traceId,
        });
        media = mergeMediaUnderstanding(media, incremental);
      }
      ctx = builder.build({
        platform,
        externalVideoId,
        sourceUrl,
        metadata: ctx.metadata,
        transcriptText: transcript,
        media,
      });
      products = await reasonValidateRank(admin, ctx, correlationId, traceId, 's3');
      gate = stagePass(products);
      finalStage = 'stage3';
      emitPipelineEvent('stage.gate', { ingestId: correlationId, stage: 3, ...gate });
    } catch (e) {
      emitPipelineEvent('stage.gate', {
        ingestId: correlationId,
        stage: 3,
        pass: false,
        error: (e as Error).message?.slice(0, 200),
      });
    }
  }

  if (workDir) {
    await videoProvider.cleanup?.(path.join(workDir, 'x'));
  }

  products = enrichEvidence(products, frames);
  const status: 'ready_for_review' | 'review_required' =
    products.length > 0 ? 'ready_for_review' : 'review_required';

  await setVideoExtractionCache(admin, {
    platform,
    externalVideoId,
    products,
    finalStage,
    status,
    youtubeMetadata: { title, description, descriptionSource, creator, thumbnailUrl },
  });

  return {
    kind: 'ok',
    products,
    status,
    finalStage,
    cacheHit: false,
    metadata: { title, description, descriptionSource, creator, thumbnailUrl },
    durationMs: Math.round(performance.now() - tAll),
  };
}
