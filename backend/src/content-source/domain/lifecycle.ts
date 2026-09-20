import type { ContentProcessingStatus } from './types';

/**
 * Content Source processing lifecycle.
 *
 * Modelled on the existing ingest lifecycle (`ingest_requests.status`,
 * `extraction_jobs.status`) rather than inventing new states. Phase 2 performs
 * `RECEIVED → QUEUED` (and `FAILED → QUEUED` on a re-share). Phase 3 performs
 * `QUEUED → PROCESSING → READY | FAILED`. READY + candidate_count 0 means the source
 * was processed successfully with no product — not a system failure.
 */

export const CONTENT_PROCESSING_STATUSES: readonly ContentProcessingStatus[] = [
  'RECEIVED',
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
];

/**
 * Statuses from which global processing work may be handed to the queue.
 *
 * `RECEIVED` covers both a brand-new source and one whose enqueue previously failed, so
 * it doubles as the durable re-enqueue signal.
 */
export const ENQUEUEABLE_STATUSES: readonly ContentProcessingStatus[] = ['RECEIVED', 'FAILED'];

export const PROCESSING_CLAIM_STATUSES: readonly ContentProcessingStatus[] = [
  'QUEUED',
  'PROCESSING',
];

const ALLOWED_TRANSITIONS: Record<ContentProcessingStatus, readonly ContentProcessingStatus[]> = {
  RECEIVED: ['QUEUED'],
  QUEUED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['READY', 'FAILED'],
  // Re-processing a known source (new pipeline version) re-enters the queue.
  READY: ['QUEUED'],
  FAILED: ['QUEUED'],
};

export function isContentProcessingStatus(value: string): value is ContentProcessingStatus {
  return (CONTENT_PROCESSING_STATUSES as readonly string[]).includes(value);
}

/** Whether a share should hand global work to the queue, given the current status. */
export function shouldEnqueueProcessing(status: ContentProcessingStatus): boolean {
  return ENQUEUEABLE_STATUSES.includes(status);
}

/** Whether a worker may claim this row and run extraction. */
export function shouldClaimForProcessing(status: ContentProcessingStatus): boolean {
  return PROCESSING_CLAIM_STATUSES.includes(status);
}

export function canTransitionContentProcessingStatus(
  from: ContentProcessingStatus,
  to: ContentProcessingStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
