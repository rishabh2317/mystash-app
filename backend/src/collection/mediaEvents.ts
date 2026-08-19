import { ingestLog } from '../pipeline/ingestLog';
import type { MediaProcessingStatus } from './domain/types';

export type MediaEventName =
  | 'MediaAttached'
  | 'MetadataSynced'
  | 'MediaProcessingStarted'
  | 'MediaProcessingCompleted'
  | 'MediaProcessingFailed'
  | 'SourceUnavailable';

export type MediaEventPayload = {
  mediaId: string;
  collectionId: string;
  processingStatus: MediaProcessingStatus;
  occurredAt: string;
  jobId?: string | null;
  errorCode?: string | null;
};

export function emitMediaEvent(
  event: MediaEventName,
  payload: Omit<MediaEventPayload, 'occurredAt'> & { occurredAt?: string },
): void {
  ingestLog('info', event, {
    svc: 'collection-media',
    mediaId: payload.mediaId,
    collectionId: payload.collectionId,
    processingStatus: payload.processingStatus,
    occurredAt: payload.occurredAt ?? new Date().toISOString(),
    jobId: payload.jobId ?? null,
    errorCode: payload.errorCode ?? null,
  });
}
