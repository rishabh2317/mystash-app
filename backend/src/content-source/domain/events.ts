import type { ContentProcessingStatus, ContentSourcePlatform } from './types';

export type ContentSourceEventName =
  | 'ContentSourceCreated'
  | 'ContentSourceReused'
  | 'ContentSourceProcessingQueued'
  | 'ContentSourceProcessingSuppressed'
  | 'ContentSourceEnqueueFailed'
  | 'ContentSourceProcessingStarted'
  | 'ContentSourceExtractionCacheHit'
  | 'ContentSourceExtractionCacheMiss'
  | 'ContentSourceExtractionCompleted'
  | 'ContentSourceCandidatesDetected'
  | 'ContentSourceCandidatesPersisted'
  | 'ContentSourceProcessingCompleted'
  | 'ContentSourceProcessingFailed'
  | 'ContentSourceProcessingRetryableFailure'
  | 'ContentSourceProcessingTerminalFailure';

export type ContentSourceEventPayload = {
  contentSourceId: string;
  platform: ContentSourcePlatform | null;
  externalId: string | null;
  mediaKind: string | null;
  processingStatus: ContentProcessingStatus | null;
  /** Triggering submission, for tracing only — work identity is the content source. */
  userImportId?: string | null;
  jobId?: string | null;
  reason?: string;
  candidateCount?: number | null;
  durationMs?: number | null;
  cacheHit?: boolean | null;
  importCount?: number | null;
  retryable?: boolean | null;
  extractionMethod?: string | null;
};

export function buildContentSourceEventPayload(
  partial: ContentSourceEventPayload,
): ContentSourceEventPayload {
  return {
    contentSourceId: partial.contentSourceId,
    platform: partial.platform ?? null,
    externalId: partial.externalId ?? null,
    mediaKind: partial.mediaKind ?? null,
    processingStatus: partial.processingStatus ?? null,
    userImportId: partial.userImportId ?? null,
    jobId: partial.jobId ?? null,
    reason: partial.reason,
    candidateCount: partial.candidateCount ?? null,
    durationMs: partial.durationMs ?? null,
    cacheHit: partial.cacheHit ?? null,
    importCount: partial.importCount ?? null,
    retryable: partial.retryable ?? null,
    extractionMethod: partial.extractionMethod ?? null,
  };
}
