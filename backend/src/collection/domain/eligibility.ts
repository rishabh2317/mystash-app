import type { Collection, CollectionStatus, CollectionVisibility, ModerationState } from './types';

export type EligibilityFlags = {
  feedEligible: boolean;
  searchEligible: boolean;
  recsEligible: boolean;
};

export function deriveEligibility(input: {
  status: CollectionStatus;
  visibility: CollectionVisibility;
  moderationState: ModerationState;
  deletedAt: string | null;
  qualityScore?: number | null;
}): EligibilityFlags {
  const publiclyAddressable =
    input.status === 'published' &&
    input.visibility === 'public' &&
    input.moderationState === 'clear' &&
    !input.deletedAt;

  const qualityOk =
    input.qualityScore == null || Number.isFinite(input.qualityScore);

  return {
    feedEligible: publiclyAddressable,
    searchEligible: publiclyAddressable,
    recsEligible: publiclyAddressable && qualityOk,
  };
}

export function applyEligibilityToCollection(
  collection: Pick<
    Collection,
    'status' | 'visibility' | 'moderationState' | 'deletedAt' | 'qualityScore'
  >,
): EligibilityFlags {
  return deriveEligibility(collection);
}
