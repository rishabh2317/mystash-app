import { logger } from '../logger';
import type {
  CandidatePageType,
  PageCapabilities,
  PageType,
  SearchCandidate,
  SourceType,
} from '../product-intelligence/domain/types';
import {
  scoreCandidateDecisions,
  sourceAuthorityFor,
  destinationSpecificityFor,
} from '../product-intelligence/scoring/CandidateScoring';
import {
  classifyCandidatePage,
  legacyCandidatePageType,
} from '../product-intelligence/search/CandidatePageClassifier';
import { validHttpUrl } from './urlValidation';
import {
  classifyShoppingProvider,
  getShoppingProviderPriority,
} from './shoppingPriorityConfig';

export type ShoppingOffer = {
  url: string;
  merchant?: string | null;
  sourceType?: SourceType;
  pageType?: PageType;
  capabilities?: PageCapabilities;
  shoppingScore?: number;
  sourceAuthority?: number;
  affiliateSupported?: boolean;
  merchantPriority?: number;
  pdpScore?: number;
  availability?: string | null;
  /** @deprecated Compatibility inputs. */
  sourceTier?: 'official' | 'marketplace' | 'retailer' | 'editorial' | null;
  candidatePageType?: CandidatePageType;
  shoppingEligible?: boolean;
};

type ScoredShoppingOffer = {
  url: string;
  merchant: string | null;
  sourceType: SourceType;
  pageType: PageType;
  capabilities: PageCapabilities;
  shoppingScore: number;
  sourceAuthority: number;
  affiliateSupported: boolean;
  merchantPriority: number;
  pdpScore: number;
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
    sourceType: SourceType;
    pageType: PageType;
    capabilities: PageCapabilities;
    /** @deprecated Compatibility projection. */
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

function toCandidate(offer: ScoredShoppingOffer): SearchCandidate {
  return {
    merchant: offer.merchant,
    merchantUrl: offer.url,
    title: offer.merchant ?? 'Product',
    image: null,
    score: 0,
    pdpScore: offer.pdpScore,
    pdpVerdict: 'pdp',
    sourceTier: offer.sourceTier ?? undefined,
    sourceType: offer.sourceType,
    pageType: offer.pageType,
    capabilities: offer.capabilities,
    candidatePageType: legacyCandidatePageType(offer.sourceType, offer.pageType),
    shoppingEligible: offer.capabilities.commerce,
    enrichmentMeta: { availability: offer.availability },
  };
}

function scoreOffers(offers: ShoppingOffer[], priority: string[]): ScoredShoppingOffer[] {
  return offers
    .map((offer): ScoredShoppingOffer | null => {
      const url = validHttpUrl(offer.url);
      if (!url) return null;

      const fallback = classifyCandidatePage({
        url,
        sourceTier: offer.sourceTier,
        title: offer.merchant,
      });
      const sourceType = offer.sourceType ?? fallback.sourceType;
      const pageType = offer.pageType ?? fallback.pageType;
      const capabilities = offer.capabilities ?? fallback.capabilities;
      if (!capabilities.commerce) {
        logger.info(
          {
            merchant: offer.merchant ?? null,
            sourceType,
            pageType,
            commerceCapable: false,
            rejectionReason: 'commerce_capability_disabled',
          },
          'shopping.candidate.rejected',
        );
        return null;
      }

      const shoppingProvider = classifyShoppingProvider(url, sourceType);
      const merchantPriority =
        offer.merchantPriority ?? priorityScore(shoppingProvider, priority);
      const affiliateSupported = offer.affiliateSupported ?? false;
      const pdpScore = Math.max(0, Math.min(1, offer.pdpScore ?? 0));
      const base: ScoredShoppingOffer = {
        url,
        merchant: offer.merchant ?? null,
        sourceType,
        pageType,
        capabilities,
        shoppingScore: 0,
        sourceAuthority: offer.sourceAuthority ?? sourceAuthorityFor(sourceType),
        affiliateSupported,
        merchantPriority,
        pdpScore,
        availability: offer.availability ?? null,
        sourceTier: offer.sourceTier,
        shoppingProvider,
      };
      const scores = scoreCandidateDecisions(toCandidate(base), {
        merchantPriority,
        affiliateSupported,
      });
      base.shoppingScore = offer.shoppingScore ?? scores.shoppingScore;
      return base;
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

/** Shopping-only decision routed through candidate commerce capabilities. */
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
        sourceType: offer.sourceType,
        pageType: offer.pageType,
        shoppingScore: offer.shoppingScore,
        sourceAuthority: offer.sourceAuthority,
        pdpScore: offer.pdpScore,
        commerceCapable: offer.capabilities.commerce,
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
      sourceType: offer.sourceType,
      pageType: offer.pageType,
      capabilities: offer.capabilities,
      candidatePageType: legacyCandidatePageType(offer.sourceType, offer.pageType),
      shoppingScore: offer.shoppingScore,
      sourceAuthority: offer.sourceAuthority,
      merchantPriority: offer.merchantPriority,
    })),
  };
}

/** Verification merchant prefers specific product destinations over hubs. */
export function pickVerificationMerchantUrl(
  offers: ShoppingOffer[],
): { merchantUrl: string; merchant: string | null; sourceTier: string } | null {
  const valid = scoreOffers(offers, getShoppingProviderPriority()).sort(
    (a, b) =>
      destinationSpecificityFor(b.url, b.pageType) -
        destinationSpecificityFor(a.url, a.pageType) ||
      Number(b.sourceType === 'OFFICIAL' && b.pageType === 'PRODUCT') -
        Number(a.sourceType === 'OFFICIAL' && a.pageType === 'PRODUCT') ||
      b.sourceAuthority - a.sourceAuthority ||
      b.pdpScore - a.pdpScore,
  );
  const chosen = valid[0];
  if (!chosen) return null;
  return {
    merchantUrl: chosen.url,
    merchant: chosen.merchant,
    sourceTier: chosen.sourceTier ?? chosen.sourceType.toLowerCase(),
  };
}
