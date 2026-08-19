import type { RecommendationStrength, SelectionSource, TagStatus } from './types';

export type ProductTagEventName =
  | 'ProductTagProposed'
  | 'ProductTagAccepted'
  | 'ProductTagRejected'
  | 'ProductTagAddedManual'
  | 'ProductTagNoteUpdated'
  | 'ProductTagStrengthChanged'
  | 'ProductTagUpdated'
  | 'ProductTagRematched'
  | 'ProductTagReordered'
  | 'ProductTagVisibilityChanged'
  | 'ProductTagRemoved'
  | 'ProductTagPublished'
  | 'ProductTagUnpublished';

export type ProductTagEventPayload = {
  collectionProductTagId: string;
  collectionId: string;
  catalogProductId?: string | null;
  occurredAt: string;
  tagStatus?: TagStatus;
  selectionSource?: SelectionSource;
  recommendationStrength?: RecommendationStrength;
  from?: string;
  to?: string;
};

export function buildProductTagEventPayload(
  partial: Omit<ProductTagEventPayload, 'occurredAt'> & { occurredAt?: string },
): ProductTagEventPayload {
  return {
    ...partial,
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
  };
}
