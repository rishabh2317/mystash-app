/** Domain types for progressive multimodal ingest (provider-agnostic). */

export type EvidenceSource =
  | 'VISION'
  | 'OCR'
  | 'LOGO'
  | 'SCENE'
  | 'TRANSCRIPT'
  | 'METADATA';

export type BBox = { x: number; y: number; w: number; h: number };

export type DetectedObject = {
  label: string;
  confidence: number;
  bbox?: BBox;
  frameIndex: number;
  timestampMs: number;
  attributes?: {
    colour?: string; material?: string; fit?: string; style?: string;
    brandText?: string; visibleIdentifier?: string;
    uncertainty?: string[];
  };
};

export type DetectedLogo = {
  description: string;
  confidence: number;
  frameIndex: number;
  timestampMs: number;
};

export type SceneInfo = {
  label: string;
  confidence: number;
  environment?: string;
};

export type ActivityInfo = {
  label: string;
  confidence: number;
};

export type OcrLine = {
  text: string;
  confidence: number;
  frameIndex: number;
  timestampMs: number;
};

export type FrameRef = {
  index: number;
  timestampMs: number;
  storagePath: string;
  localPath?: string;
  base64Jpeg?: string;
};

export type MediaUnderstandingResult = {
  objects: DetectedObject[];
  logos: DetectedLogo[];
  scene: SceneInfo;
  activities: ActivityInfo[];
  ocr: OcrLine[];
  frames: FrameRef[];
  providerMeta: {
    failed?: string[];
    vision?: string;
    ocr?: string;
    logo?: string;
    scene?: string;
  };
};

export type MultimodalContext = {
  platform: string;
  externalVideoId: string;
  sourceUrl: string;
  metadata: {
    title?: string;
    description?: string;
    creator?: string;
    hashtags?: string[];
    thumbnailUrl?: string | null;
  };
  transcript: {
    text: string;
    length: number;
    available: boolean;
  };
  media: MediaUnderstandingResult | null;
  frames: Array<{ index: number; timestampMs: number; storagePath?: string }>;
  pipelineVersion: string;
  providerVersion: string;
};

export type ProductEvidence = {
  uncertainty?: string[];
  attributes?: { attribute: string; value: string; origin: 'observed' | 'source_text'; frameIndex?: number; timestampMs?: number }[];
  stages?: string[];
  identification?: { version: 1; kind: 'possible'; reason: string };
  rejectedHypotheses?: { reason: string; stage: string }[];
  summary: string;
  frames: Array<{
    frameIndex: number;
    timestampMs: number;
    storagePath?: string;
    visibility?: string;
  }>;
  frameCount: number;
  logoHits: string[];
  transcriptMentions: boolean;
  ocrMentions: boolean;
};

export type ProductCandidate = {
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  confidence: number;
  evidence: ProductEvidence | string;
  sources: EvidenceSource[];
  reasoning?: string;
  price?: string;
  currency?: string;
  merchantUrl?: string;
  image?: string;
  externalId?: string;
  sortOrder?: number;
  includeByDefault?: boolean;
};

export type StagePassResult = {
  pass: boolean;
  productCount: number;
  maxConfidence: number;
  reason: string;
};

export type PipelineRunStatus =
  | 'running'
  | 'ready_for_review'
  | 'review_required'
  | 'failed'
  | 'cached';

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Included in completionTokens; do not add again when comparing totals. */
  reasoningTokens?: number;
  cachedTokens?: number;
};

export type ProviderCallMeta = {
  provider: string;
  model?: string;
  durationMs: number;
  tokenUsage?: TokenUsage;
  costUsd?: number;
};
