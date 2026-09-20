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

/**
 * Global work identity: keyed on the content source, never the user. Three users sharing
 * the same source collapse onto one job id, so only one global processing job exists.
 */
export function contentSourceProcessingJobId(contentSourceId: string): string {
  return `content-source-${contentSourceId}`;
}
