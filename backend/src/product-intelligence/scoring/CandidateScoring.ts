import type { CandidatePageType, SearchCandidate } from '../domain/types';
import { computeWeightedMetadataCompleteness, validPriceValue } from '../enrichment/MetadataQuality';
import { classifyCandidatePage } from '../search/CandidatePageClassifier';

export type CandidateDecisionScores = {
  sourceAuthority: number;
  metadataScore: number;
  shoppingScore: number;
  metadataCompleteness: number;
};

const AUTHORITY_BY_PAGE_TYPE: Record<CandidatePageType, number> = {
  official_product: 100,
  marketplace_pdp: 75,
  retailer_pdp: 85,
  review_site: 40,
  comparison_site: 35,
  official_brand_news: 30,
};

export function sourceAuthorityFor(pageType: CandidatePageType): number {
  return AUTHORITY_BY_PAGE_TYPE[pageType];
}

function pageTypeOf(candidate: SearchCandidate): CandidatePageType {
  return (
    candidate.candidatePageType ??
    classifyCandidatePage({
      url: candidate.merchantUrl,
      sourceTier: candidate.sourceTier,
    }).pageType
  );
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
  const pageType = pageTypeOf(candidate);
  const sourceAuthority = sourceAuthorityFor(pageType);
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

  const usage = classifyCandidatePage({
    url: candidate.merchantUrl,
    sourceTier: candidate.sourceTier,
  });
  const shoppingEligible = candidate.shoppingEligible ?? usage.shoppingEligible;
  const pdpScore = Math.round(Math.max(0, Math.min(1, candidate.pdpScore ?? 0)) * 25);
  const officialBonus = pageType === 'official_product' ? 45 : 0;
  const shoppingScore = shoppingEligible
    ? Math.round(
        officialBonus +
          pdpScore +
          sourceAuthority * 0.15 +
          availabilityScore(availability) +
          (options.affiliateSupported ? 5 : 0) +
          Math.max(0, Math.min(10, options.merchantPriority ?? 0)),
      )
    : 0;

  return { sourceAuthority, metadataScore, shoppingScore, metadataCompleteness };
}
