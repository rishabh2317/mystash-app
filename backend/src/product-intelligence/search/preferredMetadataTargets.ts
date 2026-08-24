import type { SearchCandidate } from '../domain/types';
import { isAmazonMarketplaceHost, isExactProductBuyingUrl } from '../../shopping/productUrlIdentity';
import type { ShortlistedCandidate } from './CandidateShortlister';

export const PREFERRED_METADATA_STOP_COMPLETENESS = 90;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isProductPage(candidate: SearchCandidate): boolean {
  return candidate.pageType == null || candidate.pageType === 'PRODUCT';
}

export function isOfficialPreferredMetadataCandidate(candidate: SearchCandidate): boolean {
  if (!isProductPage(candidate)) return false;
  return candidate.sourceType === 'OFFICIAL' || candidate.sourceTier === 'official';
}

export function isAmazonPreferredMetadataCandidate(candidate: SearchCandidate): boolean {
  if (!isProductPage(candidate)) return false;
  if (
    candidate.sourceType === 'MARKETPLACE' &&
    isAmazonMarketplaceHost(hostOf(candidate.merchantUrl))
  ) {
    return true;
  }
  return isAmazonMarketplaceHost(hostOf(candidate.merchantUrl));
}

function pdpRank(candidate: SearchCandidate): number {
  return typeof candidate.pdpScore === 'number' && Number.isFinite(candidate.pdpScore)
    ? candidate.pdpScore
    : 0;
}

function preferredRank(candidate: SearchCandidate): number {
  return pdpRank(candidate) + (isExactProductBuyingUrl(candidate.merchantUrl) ? 25 : 0);
}

/** One Official PDP: highest-ranked product page, collapsing regional duplicates. */
export function pickCanonicalOfficialPdp<T extends SearchCandidate>(candidates: T[]): T | undefined {
  const official = candidates.filter(isOfficialPreferredMetadataCandidate);
  if (!official.length) return undefined;
  return [...official].sort((a, b) => preferredRank(b) - preferredRank(a))[0];
}

/** One Amazon PDP: prefer an exact buying URL when present. */
export function pickCanonicalAmazonPdp<T extends SearchCandidate>(candidates: T[]): T | undefined {
  const amazon = candidates.filter(isAmazonPreferredMetadataCandidate);
  if (!amazon.length) return undefined;
  return [...amazon].sort((a, b) => preferredRank(b) - preferredRank(a))[0];
}

/** Official brand PDP then Amazon PDP — at most one URL per merchant family. */
export function pickPreferredMetadataTargets<T extends SearchCandidate>(candidates: T[]): T[] {
  const official = pickCanonicalOfficialPdp(candidates);
  const amazon = pickCanonicalAmazonPdp(candidates);
  return [official, amazon].filter((candidate): candidate is T => Boolean(candidate));
}

export function shouldStopAfterPreferredMetadata(completeness: number): boolean {
  return completeness >= PREFERRED_METADATA_STOP_COMPLETENESS;
}

export function officialPreferredSearchQuery(productQuery: string, brand?: string | null): string {
  const base = productQuery.trim();
  const brandPart = brand?.trim();
  if (brandPart && !base.toLowerCase().includes(brandPart.toLowerCase())) {
    return `${brandPart} ${base} official`;
  }
  return `${base} official`;
}

export function amazonPreferredSearchQuery(productQuery: string): string {
  return `${productQuery.trim()} site:amazon.com`;
}

export function mergeSearchCandidates(
  ...groups: SearchCandidate[][]
): SearchCandidate[] {
  const seen = new Set<string>();
  const out: SearchCandidate[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const key = candidate.merchantUrl;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
  }
  return out;
}

export function toDiscoveryCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  return candidates.map((c) => ({
    merchant: c.merchant,
    merchantUrl: c.merchantUrl,
    title: c.title,
    snippet: c.snippet,
    image: null,
    score: c.score,
  }));
}

export type PreferredDiscoveryPool = {
  preferred: ShortlistedCandidate[];
  fallbackShortlist: ShortlistedCandidate[];
  officialQueryUsed: string | null;
  amazonQueryUsed: string | null;
};
