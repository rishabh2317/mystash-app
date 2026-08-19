import type { MatchScoreResult, VerificationStatus } from '../domain/types';
import { isExactProductBuyingUrl } from '../../shopping/shoppingConfig';

/**
 * Final VERIFIED decision uses existing PI knobs — not specificityScore:
 * - catalogHitMinScore: trusted identity bar (same as local catalog reuse)
 * - verificationMatchMin: enrichment/admission floor
 * - pdpClassifierMin: PDP quality floor for exact-URL path
 *
 * VERIFIED requires a commerce offer AND either:
 *   (A) bestMatch.score >= catalogHitMinScore  (strong identity match)
 *   (B) exact product buying URL + match >= verificationMatchMin
 *       + pdpScore >= pdpClassifierMin
 */
export function decideProductVerification(input: {
  hasCommerceOffer: boolean;
  bestMatch: MatchScoreResult;
  identityUrl: string | null | undefined;
  bestPdpScore: number;
  catalogHitMinScore: number;
  verificationMatchMin: number;
  pdpClassifierMin: number;
  hadExistingCatalog: boolean;
}): {
  verificationStatus: VerificationStatus;
  decision: string;
  identityPath: 'strong_match' | 'exact_buying_url' | 'none';
} {
  if (!input.hasCommerceOffer) {
    return {
      verificationStatus: 'UNVERIFIED',
      decision: input.hadExistingCatalog ? 'updated_metadata_only' : 'created_metadata_only',
      identityPath: 'none',
    };
  }

  if (input.bestMatch.score >= input.catalogHitMinScore) {
    return {
      verificationStatus: 'VERIFIED',
      decision: input.hadExistingCatalog ? 'updated_verified' : 'created_verified',
      identityPath: 'strong_match',
    };
  }

  const exactUrl =
    typeof input.identityUrl === 'string' && isExactProductBuyingUrl(input.identityUrl);
  if (
    exactUrl &&
    input.bestMatch.score >= input.verificationMatchMin &&
    input.bestPdpScore >= input.pdpClassifierMin
  ) {
    return {
      verificationStatus: 'VERIFIED',
      decision: input.hadExistingCatalog ? 'updated_verified' : 'created_verified',
      identityPath: 'exact_buying_url',
    };
  }

  return {
    verificationStatus: 'UNVERIFIED',
    decision: input.hadExistingCatalog
      ? 'updated_unverified_weak_identity'
      : 'created_unverified_weak_identity',
    identityPath: 'none',
  };
}
