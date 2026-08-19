import { ingestLog } from '../pipeline/ingestLog';
import type { CollectionEventName, CollectionEventPayload } from './domain/events';

export function emitCollectionEvent(
  event: CollectionEventName,
  payload: CollectionEventPayload,
): void {
  ingestLog('info', event, {
    svc: 'collection',
    collectionId: payload.collectionId,
    creatorId: payload.creatorId,
    status: payload.status,
    contentRevision: payload.contentRevision,
    occurredAt: payload.occurredAt,
    ingestId: payload.ingestId ?? null,
    slug: payload.slug ?? null,
  });
}
