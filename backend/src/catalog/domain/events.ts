import type { CatalogStatus, VerificationStatus } from './types';

export type CatalogEventName =
  | 'ProductCreated'
  | 'ProductVerified'
  | 'ProductUnverified'
  | 'CatalogUpdated'
  | 'AliasAdded'
  | 'LifecycleChanged'
  | 'ProductMerged'
  | 'ShoppingProjectionUpdated';

export type CatalogEventPayload = {
  catalogProductId: string;
  occurredAt: string;
  slug?: string;
  verificationStatus?: VerificationStatus;
  source?: string;
  reason?: string;
  alias?: string;
  from?: string;
  to?: string;
  changedFields?: string[];
  sourceId?: string;
  targetId?: string;
  survivorId?: string;
  provider?: string;
  version?: string;
  confidence?: number | null;
};

export function buildCatalogEventPayload(
  partial: Omit<CatalogEventPayload, 'occurredAt'> & { occurredAt?: string },
): CatalogEventPayload {
  return {
    ...partial,
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
  };
}

export type { CatalogStatus };
