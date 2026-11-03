/**
 * User-facing share progress for Bag / Activity. Never expose queue/resolver names.
 *
 * Terminal states: ready | nothing_yet | couldnt_finish.
 * Historical adapter only; production reports use find/outcome.ts.
 */

import type { ContentProcessingStatus } from '../../content-source/domain/types';

export type ShareProgressState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

/** Delay notice threshold; never a processing deadline. */
export const USER_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

export function shareProgressState(source: {
  processingStatus: ContentProcessingStatus;
  candidateCount: number;
  /** Resolved places plus unresolved leads for this import. Omitted means none yet. */
  placeCardCount?: number;
} | null): ShareProgressState {
  if (!source) return 'looking';
  if (source.processingStatus === 'FAILED') return 'couldnt_finish';
  if (source.processingStatus === 'READY') {
    const placeCards = source.placeCardCount ?? 0;
    return source.candidateCount > 0 || placeCards > 0 ? 'ready' : 'nothing_yet';
  }
  return 'looking';
}

export type ShareProgressInput = {
  source: {
    processingStatus: ContentProcessingStatus;
    candidateCount: number;
    placeCardCount?: number;
  } | null;
  /** Historical marker, ignored by current outcome projection. */
  timedOutAt: string | null;
  createdAt: string;
  attemptStartedAt?: string | null;
  nowMs?: number;
};

/** Historical boundary adapter; timeout markers no longer freeze presentation. */
export function resolveShareProgressState(input: ShareProgressInput): ShareProgressState {
  return shareProgressState(input.source);
}

/** Retired timer policy. No new presentation timeout is persisted. */
export function shouldPersistImportTimeout(input: ShareProgressInput): boolean {
  void input;
  return false;
}
