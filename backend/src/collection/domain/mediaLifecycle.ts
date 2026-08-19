import type { MediaProcessingStatus } from './types';

const ALLOWED: Record<MediaProcessingStatus, MediaProcessingStatus[]> = {
  imported: ['processing', 'ready', 'archived'],
  processing: ['ready', 'failed'],
  ready: ['processing', 'archived'],
  failed: ['processing', 'archived'],
  archived: [],
};

export function canMediaTransition(
  from: MediaProcessingStatus,
  to: MediaProcessingStatus,
): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertMediaTransition(
  from: MediaProcessingStatus,
  to: MediaProcessingStatus,
): void {
  if (!canMediaTransition(from, to)) {
    throw new Error(`Invalid media processingStatus transition: ${from} → ${to}`);
  }
}
