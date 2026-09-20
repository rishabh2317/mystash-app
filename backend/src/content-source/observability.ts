import { ingestLog } from '../pipeline/ingestLog';
import type { ContentSourceEventName, ContentSourceEventPayload } from './domain/events';

export function emitContentSourceEvent(
  event: ContentSourceEventName,
  payload: ContentSourceEventPayload,
): void {
  ingestLog('info', event, {
    svc: 'content-source',
    domain: 'content-source',
    contentSourceId: payload.contentSourceId,
    platform: payload.platform,
    externalId: payload.externalId,
    mediaKind: payload.mediaKind,
    processingStatus: payload.processingStatus,
    userImportId: payload.userImportId ?? null,
    jobId: payload.jobId ?? null,
    reason: payload.reason ?? null,
    candidateCount: payload.candidateCount ?? null,
    durationMs: payload.durationMs ?? null,
    cacheHit: payload.cacheHit ?? null,
    importCount: payload.importCount ?? null,
    retryable: payload.retryable ?? null,
    extractionMethod: payload.extractionMethod ?? null,
  });
}
