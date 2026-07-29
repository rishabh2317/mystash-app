import { logger } from '../logger';
import type { CandidatePageType, SearchCandidate } from '../product-intelligence/domain/types';
import { scoreCandidateDecisions, sourceAuthorityFor } from '../product-intelligence/scoring/CandidateScoring';
import { classifyCandidatePage } from '../product-intelligence/search/CandidatePageClassifier';
import { validHttpUrl } from './urlValidation';
import {
  classifyShoppingProvider,
  getShoppingProviderPriority,
} from './shoppingPriorityConfig';

export type ShoppingOffer = {
  url: string;
  merchant?: string | null;
  candidatePageType?: CandidatePageType;
  shoppingScore?: number;
  sourceAuthority?: number;
  affiliateSupported?: boolean;
  shoppingEligible?: boolean;
  merchantPriority?: number;
  pdpScore?: number;
  availability?: string | null;
  sourceTier?: 'official' | 'marketplace' | 'retailer' | 'editorial' | null;
};

type ScoredShoppingOffer = Required<
  Pick<
    ShoppingOffer,
    | 'url'
    | 'candidatePageType'
    | 'shoppingScore'
    | 'sourceAuthority'
    | 'affiliateSupported'
    | 'shoppingEligible'
    | 'merchantPriority'
    | 'pdpScore'
  >
> & {
  merchant: string | null;
  availability: string | null;
  sourceTier: ShoppingOffer['sourceTier'];
  shoppingProvider: string;
};

export type ShoppingDestinationChoice = {
  preferredShoppingUrl: string;
  shoppingProvider: string;
  offers: Array<{
    url: string;
    shoppingProvider: string;
    sourceTier: string | null;
    candidatePageType: CandidatePageType;
    shoppingScore: number;
    sourceAuthority: number;
    merchantPriority: number;
  }>;
};

function priorityScore(provider: string, priority: string[]): number {
  const index = priority.indexOf(provider);
  return index < 0 ? 0 : Math.max(1, 10 - index);
}

function toCandidate(offer: {
  url: string;
  merchant: string | null;
  candidatePageType: CandidatePageType;
  shoppingEligible: boolean;
  pdpScore: number;
  sourceTier: ShoppingOffer['sourceTier'];
  availability: string | null;
}): SearchCandidate {
  return {
    merchant: offer.merchant,
    merchantUrl: offer.url,
    title: offer.merchant ?? 'Product',
    image: null,
    score: 0,
    pdpScore: offer.pdpScore,
    pdpVerdict: 'pdp',
    sourceTier: offer.sourceTier ?? undefined,
    candidatePageType: offer.candidatePageType,
    shoppingEligible: offer.shoppingEligible,
    enrichmentMeta: { availability: offer.availability },
  };
}

function scoreOffers(offers: ShoppingOffer[], priority: string[]): ScoredShoppingOffer[] {
  return offers
    .map((offer): ScoredShoppingOffer | null => {
      const url = validHttpUrl(offer.url);
      if (!url) return null;

      const usage = classifyCandidatePage({ url, sourceTier: offer.sourceTier });
      const candidatePageType = offer.candidatePageType ?? usage.pageType;
      const shoppingEligible = offer.shoppingEligible ?? usage.shoppingEligible;
      const hardEligible =
        shoppingEligible &&
        ['official_product', 'marketplace_pdp', 'retailer_pdp'].includes(candidatePageType);
      if (!hardEligible) {
        logger.info(
          {
            merchant: offer.merchant ?? null,
            candidateType: candidatePageType,
            shoppingEligible: false,
            rejectionReason: 'not_a_purchasable_pdp',
          },
          'shopping.candidate.rejected',
        );
        return null;
      }

      const shoppingProvider = classifyShoppingProvider(url, offer.sourceTier);
      const merchantPriority =
        offer.merchantPriority ?? priorityScore(shoppingProvider, priority);
      const affiliateSupported = offer.affiliateSupported ?? false;
      const pdpScore = Math.max(0, Math.min(1, offer.pdpScore ?? 0));
      const candidate = toCandidate({
        url,
        merchant: offer.merchant ?? null,
        candidatePageType,
        shoppingEligible,
        pdpScore,
        sourceTier: offer.sourceTier,
        availability: offer.availability ?? null,
      });
      const scores = scoreCandidateDecisions(candidate, {
        merchantPriority,
        affiliateSupported,
      });
      const sourceAuthority =
        offer.sourceAuthority ?? sourceAuthorityFor(candidatePageType);
      const shoppingScore = offer.shoppingScore ?? scores.shoppingScore;

      return {
        url,
        merchant: offer.merchant ?? null,
        candidatePageType,
        shoppingScore,
        sourceAuthority,
        affiliateSupported,
        shoppingEligible,
        merchantPriority,
        pdpScore,
        availability: offer.availability ?? null,
        sourceTier: offer.sourceTier,
        shoppingProvider,
      };
    })
    .filter((offer): offer is ScoredShoppingOffer => offer !== null)
    .sort(
      (a, b) =>
        b.shoppingScore - a.shoppingScore ||
        b.merchantPriority - a.merchantPriority ||
        Number(b.affiliateSupported) - Number(a.affiliateSupported) ||
        b.sourceAuthority - a.sourceAuthority,
    );
}

/** Shopping-only decision. Metadata scores are never read here. */
export function resolveShoppingDestination(
  offers: ShoppingOffer[],
  priority: string[] = getShoppingProviderPriority(),
): ShoppingDestinationChoice | null {
  logger.info({ offerCount: offers.length, priority }, 'shopping.resolution.started');
  const scored = scoreOffers(offers, priority);
  if (!scored.length) return null;

  const winner = scored[0]!;
  for (const offer of scored) {
    logger.info(
      {
        merchant: offer.merchant,
        candidateType: offer.candidatePageType,
        shoppingScore: offer.shoppingScore,
        sourceAuthority: offer.sourceAuthority,
        pdpScore: offer.pdpScore,
        shoppingEligible: offer.shoppingEligible,
        selectedForShopping: offer === winner,
        rejectionReason: offer === winner ? null : 'lower_shopping_score',
      },
      'shopping.candidate.decision',
    );
  }
  logger.info(
    {
      shoppingProvider: winner.shoppingProvider,
      preferredShoppingUrl: winner.url.slice(0, 160),
      shoppingScore: winner.shoppingScore,
    },
    'shopping.provider.selected',
  );

  return {
    preferredShoppingUrl: winner.url,
    shoppingProvider: winner.shoppingProvider,
    offers: scored.map((offer) => ({
      url: offer.url,
      shoppingProvider: offer.shoppingProvider,
      sourceTier: offer.sourceTier ?? null,
      candidatePageType: offer.candidatePageType,
      shoppingScore: offer.shoppingScore,
      sourceAuthority: offer.sourceAuthority,
      merchantPriority: offer.merchantPriority,
    })),
  };
}

/** Verification is authority-driven and independent from shopping and metadata merge. */
export function pickVerificationMerchantUrl(
  offers: ShoppingOffer[],
): { merchantUrl: string; merchant: string | null; sourceTier: string } | null {
  const valid = scoreOffers(offers, getShoppingProviderPriority()).sort(
    (a, b) =>
      Number(b.candidatePageType === 'official_product') -
        Number(a.candidatePageType === 'official_product') ||
      b.sourceAuthority - a.sourceAuthority ||
      b.pdpScore - a.pdpScore,
  );
  const chosen = valid[0];
  if (!chosen) return null;
  return {
    merchantUrl: chosen.url,
    merchant: chosen.merchant,
    sourceTier: chosen.sourceTier ?? 'retailer',
  };
}
