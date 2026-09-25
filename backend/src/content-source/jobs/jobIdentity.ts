export const CONTENT_SOURCE_QUEUE = 'content-source-processing';

/**
 * Stable ids only — never the original shared payload. The worker reads whatever it needs
 * from `content_sources` / `user_imports`, so the queue never carries stale copies.
 */
export type ContentSourceProcessingJobData = {
  contentSourceId: string;
  /** Triggering submission, for tracing only. Work identity is the content source. */
  userImportId: string;
  traceId?: string;
};

/** Background merchant enrichment after Bag insertion (user-import only). */
export type ContentSourceEnrichmentJobData = {
  contentSourceId: string;
  contentSourceProductId: string;
  discoveredProductId: string;
  userImportId: string;
  traceId?: string;
};

/** Per-user-import hard timeout — does not cancel global content_source work. */
export type UserImportTimeoutJobData = {
  userImportId: string;
};

export type ContentSourceQueueJobData =
  | ContentSourceProcessingJobData
  | ContentSourceEnrichmentJobData
  | UserImportTimeoutJobData;

/**
 * Global work identity: keyed on the content source, never the user. Three users sharing
 * the same source collapse onto one job id, so only one global processing job exists.
 */
export function contentSourceProcessingJobId(contentSourceId: string): string {
  return `content-source-${contentSourceId}`;
}

export function contentSourceEnrichmentJobId(discoveredProductId: string): string {
  return `content-source-enrich-${discoveredProductId}`;
}

export function userImportTimeoutJobId(userImportId: string): string {
  return `user-import-timeout-${userImportId}`;
}
