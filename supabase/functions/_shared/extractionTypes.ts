import type { ExtractedProduct } from './productTypes.ts';

/** Shipped to client + stored in `ingest_extractions.payload`. */
export type ExtractionError = {
  code: string;
  message: string;
  detail?: string;
};

export type ExtractionPipelineMeta = {
  transcriptAgent:
    | 'not_implemented'
    | 'youtube_captions'
    | 'youtube_captions_partial'
    | 'url_only';
  contextSources: string[];
  priceAgent: 'llm_only_unverified' | 'matcher_llm';
  agenticPipeline?: boolean;
  stagesCompleted?: string[];
};

export type ExtractionPipelineResult = {
  products: ExtractedProduct[];
  extractionSource: 'gemini' | 'mock';
  durationMs: number;
  extractionStatus: 'ok' | 'degraded';
  extractionError?: ExtractionError;
  pipelineMeta: ExtractionPipelineMeta;
};

export type ExtractionLogContext = {
  ingestId: string;
  traceId: string;
  platform: string;
  sourceHost: string;
};
