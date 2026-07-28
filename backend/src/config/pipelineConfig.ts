import { getEnv } from '../env';

function num(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback: string): string {
  return getEnv(key)?.trim() || fallback;
}

export type PipelineConfig = {
  pipelineVersion: string;
  providerVersion: string;
  minProducts: number;
  stagePassConfidence: number;
  autoApproveConfidence: number;
  reviewMinConfidence: number;
  transcriptMinChars: number;
  maxProductsPerIngest: number;
  openaiReasonerModel: string;
  openaiVisionModel: string;
  redisUrl: string;
  gcpVisionEnabled: boolean;
  frameCountLt10s: number;
  frameCount10to30s: number;
  frameCount30to90s: number;
  frameCount90sTo5m: number;
  stage3MaxFrames: number;
  rankWeightConfidence: number;
  rankWeightVisibility: number;
  rankWeightTranscript: number;
  rankWeightOcr: number;
  rankWeightLogo: number;
  rankWeightScene: number;
  categoryAllowlist: Set<string>;
};

let cached: PipelineConfig | null = null;

export function getPipelineConfig(): PipelineConfig {
  if (cached) return cached;

  const reasonerModel = str('OPENAI_REASONER_MODEL', str('OPENAI_MODEL', 'gpt-4o-mini'));
  const visionModel = str('OPENAI_VISION_MODEL', reasonerModel);
  const pipelineVersion = str('PIPELINE_VERSION', 'v5-progressive');
  const providerVersion = str(
    'PROVIDER_VERSION',
    `reasoner-${reasonerModel}+mu-openai-gcp-v1`,
  );

  cached = {
    pipelineVersion,
    providerVersion,
    minProducts: num('MIN_PRODUCTS', 1),
    stagePassConfidence: num('STAGE_PASS_CONFIDENCE', 0.6),
    autoApproveConfidence: num('AUTO_APPROVE_CONFIDENCE', 0.85),
    reviewMinConfidence: num('REVIEW_MIN_CONFIDENCE', 0.6),
    transcriptMinChars: num('TRANSCRIPT_MIN_CHARS', 40),
    maxProductsPerIngest: num('MAX_PRODUCTS_PER_INGEST', 12),
    openaiReasonerModel: reasonerModel,
    openaiVisionModel: visionModel,
    redisUrl: str('REDIS_URL', 'redis://127.0.0.1:6379'),
    gcpVisionEnabled: str('GCP_VISION_ENABLED', 'true').toLowerCase() !== 'false',
    frameCountLt10s: num('FRAME_COUNT_LT_10S', 3),
    frameCount10to30s: num('FRAME_COUNT_10_30S', 3),
    frameCount30to90s: num('FRAME_COUNT_30_90S', 5),
    frameCount90sTo5m: num('FRAME_COUNT_90S_5M', 8),
    stage3MaxFrames: num('STAGE3_MAX_FRAMES', 10),
    rankWeightConfidence: num('RANK_WEIGHT_CONFIDENCE', 0.35),
    rankWeightVisibility: num('RANK_WEIGHT_VISIBILITY', 0.2),
    rankWeightTranscript: num('RANK_WEIGHT_TRANSCRIPT', 0.15),
    rankWeightOcr: num('RANK_WEIGHT_OCR', 0.1),
    rankWeightLogo: num('RANK_WEIGHT_LOGO', 0.1),
    rankWeightScene: num('RANK_WEIGHT_SCENE', 0.1),
    categoryAllowlist: new Set(
      str(
        'CATEGORY_ALLOWLIST',
        'sports,fashion,beauty,electronics,home,food,automotive,outdoors,gaming,travel,unknown',
      )
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
  return cached;
}

/** Reset cached config (tests). */
export function resetPipelineConfigCache(): void {
  cached = null;
}

export function buildCacheKey(params: {
  platform: string;
  externalVideoId: string;
  pipelineVersion?: string;
  providerVersion?: string;
}): string {
  const cfg = getPipelineConfig();
  return [
    params.platform,
    params.externalVideoId,
    params.pipelineVersion ?? cfg.pipelineVersion,
    params.providerVersion ?? cfg.providerVersion,
  ].join(':');
}

/** Adaptive Stage-2 frame count from duration (seconds). */
export function adaptiveFrameCount(durationSec: number): number {
  const cfg = getPipelineConfig();
  if (durationSec < 10) return cfg.frameCountLt10s;
  if (durationSec < 30) return cfg.frameCount10to30s;
  if (durationSec < 90) return cfg.frameCount30to90s;
  return cfg.frameCount90sTo5m;
}

/** Uniform timestamps in ms for N frames across duration. */
export function uniformTimestampsMs(durationMs: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [Math.floor(durationMs / 2)];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.floor(((i + 1) / (count + 1)) * durationMs);
    out.push(Math.max(0, Math.min(durationMs - 1, t)));
  }
  return out;
}
