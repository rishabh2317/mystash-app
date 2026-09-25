/**
 * User-facing share progress for Bag / Activity. Never expose queue/resolver names.
 *
 * Terminal states: ready | nothing_yet | couldnt_finish.
 * looking is non-terminal and must not persist past USER_IMPORT_TIMEOUT_MS.
 */

import type { ContentProcessingStatus } from '../../content-source/domain/types';

export type ShareProgressState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

/** Hard maximum lifetime for a user-facing LOOKING import. */
export const USER_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

export function shareProgressState(source: {
  processingStatus: ContentProcessingStatus;
  candidateCount: number;
} | null): ShareProgressState {
  if (!source) return 'looking';
  if (source.processingStatus === 'FAILED') return 'couldnt_finish';
  if (source.processingStatus === 'READY') {
    return source.candidateCount > 0 ? 'ready' : 'nothing_yet';
  }
  return 'looking';
}

export type ShareProgressInput = {
  source: {
    processingStatus: ContentProcessingStatus;
    candidateCount: number;
  } | null;
  /** Durable freeze — late READY must not resurrect UX. */
  timedOutAt: string | null;
  createdAt: string;
  nowMs?: number;
};

/**
 * Resolves user-facing state with hard timeout.
 * Does not mutate storage — callers self-heal via markTimedOut when this returns
 * couldnt_finish while timedOutAt is still null.
 */
export function resolveShareProgressState(input: ShareProgressInput): ShareProgressState {
  if (input.timedOutAt) return 'couldnt_finish';
  const base = shareProgressState(input.source);
  if (base !== 'looking') return base;
  const createdMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdMs)) return 'looking';
  const nowMs = input.nowMs ?? Date.now();
  if (nowMs - createdMs >= USER_IMPORT_TIMEOUT_MS) return 'couldnt_finish';
  return 'looking';
}

/** True when looking has aged out and should be persisted as timed out. */
export function shouldPersistImportTimeout(input: ShareProgressInput): boolean {
  if (input.timedOutAt) return false;
  return resolveShareProgressState(input) === 'couldnt_finish' && shareProgressState(input.source) === 'looking';
}
