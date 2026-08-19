import { ingestLog } from '../pipeline/ingestLog';
import type { CartEventName, CartEventPayload } from './domain/events';

export function emitCartEvent(event: CartEventName, payload: CartEventPayload): void {
  ingestLog('info', event, {
    svc: 'cart',
    domain: 'cart',
    userId: payload.userId,
    catalogProductId: payload.catalogProductId,
    cartItemId: payload.cartItemId,
    created: payload.created ?? null,
    reason: payload.reason ?? null,
    sourceCollectionId: payload.source?.collectionId ?? null,
    sourceCreatorId: payload.source?.creatorId ?? null,
    sourceCollectionProductTagId: payload.source?.collectionProductTagId ?? null,
    sourceSurface: payload.source?.surface ?? null,
  });
}
