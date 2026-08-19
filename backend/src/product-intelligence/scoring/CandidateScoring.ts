import type {
  CandidateClassification,
  PageType,
  SearchCandidate,
  SourceType,
} from '../domain/types';
import { computeWeightedMetadataCompleteness, validPriceValue } from '../enrichment/MetadataQuality';
import { classifyCandidatePage } from '../search/CandidatePageClassifier';
import { isExactProductBuyingUrl } from '../../shopping/shoppingConfig';

export type CandidateDecisionScores = {
  sourceAuthority: number;
  metadataScore: number;
  shoppingScore: number;
  metadataCompleteness: number;
  destinationSpecificity: number;
};

/** Page types that must not win shopping via domain authority alone. */
const LOW_SPECIFICITY_PAGES = new Set<PageType>([
  'SEARCH',
  'SEARCH_RESULTS',
  'CATEGORY',
  'NEWS',
  'EDITORIAL',
  'REVIEW',
  'BUYING_GUIDE',
  'HOMEPAGE',
  'CAMPAIGN',
  'COMPARISON',
  'SUPPORT',
  'FAQ',
  'FORUM_THREAD',
  'PROFILE',
  'VIDEO',
  'UNKNOWN',
]);

/**
 * Merchant-agnostic destination specificity for shopping ranking.
 * Exact PDPs score materially higher than hubs/category/search/editorial pages.
 */
export function destinationSpecificityFor(
  url: string,
  pageType: PageType,
): number {
  if (LOW_SPECIFICITY_PAGES.has(pageType)) return 0;
  if (isExactProductBuyingUrl(url)) return 45;
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (pageType === 'PRODUCT' && segments.length >= 2) return 30;
    // Shallow hubs like /iphone/ classified as PRODUCT via commerce_source_default.
    if (pageType === 'PRODUCT' && segments.length <= 1) return 5;
  } catch {
    return 0;
  }
  return 0;
}

const AUTHORITY_BY_SOURCE_TYPE: Record<SourceType, number> = {
  OFFICIAL: 100,
  MARKETPLACE: 75,
  RETAILER: 85,
  SPECIFICATION: 80,
  REVIEW: 40,
  EDITORIAL: 40,
  NEWS: 30,
  FORUM: 15,
  SOCIAL: 15,
  VIDEO: 20,
  WIKI: 35,
  UNKNOWN: 0,
};

export function sourceAuthorityFor(sourceType: SourceType): number {
  return AUTHORITY_BY_SOURCE_TYPE[sourceType];
}

function classificationOf(candidate: SearchCandidate): CandidateClassification {
  if (candidate.sourceType && candidate.pageType && candidate.capabilities) {
    return {
      sourceType: candidate.sourceType,
      pageType: candidate.pageType,
      capabilities: candidate.capabilities,
    };
  }
  const classification = classifyCandidatePage({
    url: candidate.merchantUrl,
    sourceTier: candidate.sourceTier,
    title: candidate.title,
  });
  return {
    sourceType: classification.sourceType,
    pageType: classification.pageType,
    capabilities: classification.capabilities,
  };
}

function specs(candidate: SearchCandidate): Record<string, string> {
  const raw = candidate.enrichmentMeta?.specifications;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim(),
    ),
  );
}

function availabilityScore(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 5;
  if (/\b(out of stock|unavailable|sold out|discontinued)\b/i.test(value)) return 0;
  if (/\b(in stock|available|preorder|pre-order)\b/i.test(value)) return 10;
  return 5;
}

function titleQuality(value: string): number {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return 0;
  const noisy = tokens.filter((token) =>
    /^(review|rating|best|top|official|product|titled|video)$/i.test(token),
  ).length;
  return Math.max(0, Math.min(10, tokens.length <= 12 ? 10 - noisy * 2 : 6 - noisy * 2));
}

export function scoreCandidateDecisions(
  candidate: SearchCandidate,
  options: {
    merchantPriority?: number;
    affiliateSupported?: boolean;
  } = {},
): CandidateDecisionScores {
  const classification = classificationOf(candidate);
  const sourceAuthority = sourceAuthorityFor(classification.sourceType);
  const candidateSpecs = specs(candidate);
  const availability =
    typeof candidate.enrichmentMeta?.availability === 'string'
      ? candidate.enrichmentMeta.availability
      : null;
  const metadataCompleteness = computeWeightedMetadataCompleteness({
    title: candidate.title,
    brand: candidate.brand,
    image: candidate.image,
    description: candidate.description,
    price: candidate.price,
    currency: candidate.currency,
    availability,
    specifications: candidateSpecs,
  });

  const metadataScore = Math.round(
    sourceAuthority * 0.45 +
      metadataCompleteness * 0.35 +
      titleQuality(candidate.title) +
      Math.min(5, Object.keys(candidateSpecs).length) +
      (validPriceValue(candidate.price, candidate.currency) ? 5 : 0),
  );

  const shoppingEligible = classification.capabilities.commerce;
  const pdpScore = Math.round(Math.max(0, Math.min(1, candidate.pdpScore ?? 0)) * 25);
  const destinationSpecificity = destinationSpecificityFor(
    candidate.merchantUrl,
    classification.pageType,
  );
  // Official bonus only when the destination is already a specific product page —
  // never let brand-hub authority alone beat an exact PDP.
  const officialBonus =
    classification.sourceType === 'OFFICIAL' &&
    classification.pageType === 'PRODUCT' &&
    destinationSpecificity >= 30
      ? 20
      : 0;
  const shoppingScore = shoppingEligible
    ? Math.round(
        destinationSpecificity +
          officialBonus +
          pdpScore +
          sourceAuthority * 0.15 +
          availabilityScore(availability) +
          (options.affiliateSupported ? 5 : 0) +
          Math.max(0, Math.min(10, options.merchantPriority ?? 0)),
      )
    : 0;

  return {
    sourceAuthority,
    metadataScore,
    shoppingScore,
    metadataCompleteness,
    destinationSpecificity,
  };
}
