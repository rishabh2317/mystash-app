import type { SearchCandidate } from '../domain/types';
import { isExactProductBuyingUrl } from '../../shopping/productUrlIdentity';
import { classifyShoppingProvider } from '../../shopping/shoppingPriorityConfig';
import { isAmazonMarketplaceHost } from '../../shopping/productUrlIdentity';
import {
  hostAlignsWithDiscoveryCountry,
  hostOfMerchantUrl,
  isCountryPreferredAmazonHost,
} from './discoveryCountry';
import { merchantUrlsMatch } from './directUrlIdentity';

const NON_PDP_PAGE_TYPES = new Set<string>([
  'SEARCH',
  'SEARCH_RESULTS',
  'CATEGORY',
  'HOMEPAGE',
]);

/**
 * Group key for user-facing "one offer per merchant".
 * Amazon family (amazon.com / amazon.in / a.co / …) collapses to one key.
 * Named marketplaces collapse by provider id; other hosts stay host-scoped.
 */
export function merchantOfferGroupKey(url: string): string {
  const host = hostOfMerchantUrl(url);
  if (!host) return `url:${url}`;
  if (isAmazonMarketplaceHost(host)) return 'amazon';
  const provider = classifyShoppingProvider(url);
  if (provider !== 'merchant' && provider !== 'official') {
    return `provider:${provider}`;
  }
  return `host:${host}`;
}

function pageTypePenalty(pageType: SearchCandidate['pageType']): number {
  if (!pageType) return 0;
  if (NON_PDP_PAGE_TYPES.has(pageType)) return -120;
  if (pageType === 'PRODUCT') return 40;
  return 0;
}

/**
 * Rank a commerce candidate for user-import merchant-offer assembly.
 * Prefers exact PDPs over store/search/category; country-aligned hosts win ties.
 */
export function rankMerchantOfferCandidate(
  candidate: SearchCandidate,
  country?: string | null,
): number {
  let score = 0;
  score += pageTypePenalty(candidate.pageType);
  if (candidate.pdpVerdict === 'pdp') score += 35;
  if (candidate.pdpVerdict === 'not_pdp') score -= 80;
  if (isExactProductBuyingUrl(candidate.merchantUrl)) score += 55;
  const pdp = candidate.pdpScore ?? 0;
  // Classifier scores are 0–1; shortlist ranks may be 0–100.
  score += pdp > 1 ? Math.min(25, pdp / 4) : pdp * 25;
  score += Math.min(15, (candidate.shoppingScore ?? 0) / 10);

  if (country) {
    if (isCountryPreferredAmazonHost(candidate.merchantUrl, country)) score += 45;
    else if (isAmazonMarketplaceHost(hostOfMerchantUrl(candidate.merchantUrl))) score -= 25;
    else if (hostAlignsWithDiscoveryCountry(candidate.merchantUrl, country)) score += 15;
  }
  return score;
}

/**
 * Keep at most one offer per merchant/domain, choosing the best qualifying PDP.
 * Different merchants selling the same product are retained.
 */
export function pickOneOfferPerMerchant<T extends SearchCandidate>(
  candidates: T[],
  country?: string | null,
): T[] {
  const bestByGroup = new Map<string, T>();
  for (const candidate of candidates) {
    const key = merchantOfferGroupKey(candidate.merchantUrl);
    const existing = bestByGroup.get(key);
    if (!existing) {
      bestByGroup.set(key, candidate);
      continue;
    }
    const nextRank = rankMerchantOfferCandidate(candidate, country);
    const prevRank = rankMerchantOfferCandidate(existing, country);
    if (nextRank > prevRank) {
      bestByGroup.set(key, candidate);
      continue;
    }
    if (
      nextRank === prevRank &&
      !merchantUrlsMatch(existing.merchantUrl, candidate.merchantUrl) &&
      isExactProductBuyingUrl(candidate.merchantUrl) &&
      !isExactProductBuyingUrl(existing.merchantUrl)
    ) {
      bestByGroup.set(key, candidate);
    }
  }
  return [...bestByGroup.values()];
}
