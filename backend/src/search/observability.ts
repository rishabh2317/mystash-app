import { ingestLog } from '../pipeline/ingestLog';

export type SearchOpsEvent =
  | 'SearchIndexed'
  | 'SearchIndexDeleted'
  | 'SearchQueryServed'
  | 'SearchDegraded'
  | 'SearchReindexStarted'
  | 'SearchReindexCompleted';

export function emitSearchOps(
  event: SearchOpsEvent,
  payload: Record<string, unknown>,
): void {
  ingestLog('info', event, {
    svc: 'search',
    domain: 'search',
    ...payload,
  });
}
