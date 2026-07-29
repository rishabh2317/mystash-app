import { ingestLog } from '../pipeline/ingestLog';

export type PiEvent =
  | 'catalog.hit'
  | 'catalog.miss'
  | 'search.succeeded_empty'
  | 'search.failed'
  | 'catalog.created_verified'
  | 'catalog.created_unverified'
  | 'draft.unresolved'
  | 'resolve.background_enqueued'
  | 'affiliate.resolved'
  | 'specificity.assessed'
  | 'specificity.gated'
  | 'search.query_built'
  | 'pdp.rejected'
  | 'verification.decided';

export function emitPiEvent(
  event: PiEvent,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  ingestLog('info', event, { svc: 'product-intelligence', ...fields });
}
