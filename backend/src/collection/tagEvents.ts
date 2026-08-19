import { ingestLog } from '../pipeline/ingestLog';
import type { ProductTagEventName, ProductTagEventPayload } from './domain/tagEvents';

export function emitProductTagEvent(
  event: ProductTagEventName,
  payload: ProductTagEventPayload,
): void {
  ingestLog('info', event, {
    svc: 'collection-product-tag',
    collectionProductTagId: payload.collectionProductTagId,
    collectionId: payload.collectionId,
    catalogProductId: payload.catalogProductId ?? null,
    occurredAt: payload.occurredAt,
    tagStatus: payload.tagStatus ?? null,
    selectionSource: payload.selectionSource ?? null,
    recommendationStrength: payload.recommendationStrength ?? null,
    from: payload.from ?? null,
    to: payload.to ?? null,
  });
}
