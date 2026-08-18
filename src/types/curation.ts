export type IngestPlatform = 'youtube' | 'instagram' | 'unknown';

export type ExtractionStatus = 'ok' | 'degraded';

export interface ExtractionErrorInfo {
  code: string;
  message: string;
  detail?: string;
}

export interface ExtractionPipelineMetaClient {
  transcriptAgent?: string;
  contextSources?: string[];
  priceAgent?: string;
  /** True when YouTube used the 3-stage agentic path (see Edge `ExtractionPipelineMeta`). */
  agenticPipeline?: boolean;
  /** Stage markers from Edge, e.g. `["s1_context","s2_vision_ok","s3_matcher_ok"]`. */
  stagesCompleted?: string[];
}

export interface DraftProduct {
  id: string;
  name: string;
  price: string;
  currency?: string;
  provider: string;
  affiliateUrl: string;
  /** Merchant PDP URL (shoppable destination before affiliate wrap). */
  merchantUrl?: string;
  /** Display merchant label (hostname / brand shop). */
  merchant?: string;
  image?: string;
  confidence?: number;
  catalogProductId?: string;
  resolutionStatus?: 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';
  brand?: string | null;
  description?: string | null;
  /** Persisted catalog join for CatalogProductViewModel mapping. */
  catalogRow?: import('./catalogProduct').CatalogProductRow | null;
}

export interface IngestDraftPayload {
  ingestId: string;
  sourceUrl: string;
  platform: IngestPlatform;
  videoTitle?: string;
  thumbnail?: string;
  stashScore?: number;
  products: DraftProduct[];
  status: 'draft' | 'ready_for_review' | 'review_required' | 'queued' | 'failed' | 'processing' | 'rejected';
  errorMessage?: string;
  /** e.g. `openai`, `gemini`, `manual`, or dev `mock_offline`. */
  extractionSource?: string;
  /** `ok` = real AI rows; `degraded` = preview placeholders + `extractionError`. */
  extractionStatus?: ExtractionStatus;
  /** Present when extraction is degraded or Edge returned an explicit error. */
  extractionError?: ExtractionErrorInfo;
  /** Plan-phase metadata from Edge (transcript/price agents). */
  pipelineMeta?: ExtractionPipelineMetaClient;
  /** Edge extraction step duration (ms), when returned by `ingest-url`. */
  extractionDurationMs?: number;
  /** Correlates with Supabase Edge function JSON logs for the same request. */
  traceId?: string;
  /** True while async extraction job has not finished (poll DB until draft). */
  extractionPending?: boolean;
}

export interface IngestUrlResponse {
  ingestId: string;
  status: string;
  draft?: IngestDraftPayload;
  failedProductUrls?: string[];
}
