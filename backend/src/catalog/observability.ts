import { ingestLog } from '../pipeline/ingestLog';
import type { CatalogEventName, CatalogEventPayload } from './domain/events';

export function emitCatalogEvent(
  event: CatalogEventName,
  payload: CatalogEventPayload,
): void {
  const { changedFields, ...rest } = payload;
  ingestLog('info', event, {
    svc: 'catalog',
    domain: 'catalog',
    ...rest,
    changedFields: changedFields?.join(',') ?? null,
  });
}
