import type { ContentProcessingStatus } from '../../content-source/domain/types';

/**
 * User-facing share progress for Bag. Never expose queue/resolver names.
 */
export type ShareProgressState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

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
