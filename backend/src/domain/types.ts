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
};

export type ProviderCallMeta = {
  provider: string;
  durationMs: number;
  tokenUsage?: TokenUsage;
  costUsd?: number;
};
