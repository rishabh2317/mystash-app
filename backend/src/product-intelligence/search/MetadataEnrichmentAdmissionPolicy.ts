import type { SearchCandidate } from '../domain/types';

const BRAND_CONTENT_PATH =
  /\/(newsroom|news|stories|story|press|press-releases?|releases?|articles?|blog|blogs)(\/|$)/i;
const REVIEW_PATH = /\/(reviews?|tested|testing|guide|guides)(\/|[-_]|$)/i;
const COMPARISON_PATH = /\/(compare|comparison|versus|vs)(\/|[-_]|$)/i;
const REVIEW_HOST =
  /(^|\.)(runnersworld\.com|theruntesters\.com|believeintherun\.com|rtings\.com|wirecutter\.com|reviewed\.com|tomsguide\.com|cnet\.com|techradar\.com)$/i;
const COMPARISON_HOST = /(^|\.)(versus\.com|productchart\.com|gadgets360\.com)$/i;
const BLOCKED_HOST =
  /(^|\.)(youtube\.com|youtu\.be|reddit\.com|wikipedia\.org|facebook\.com|instagram\.com|x\.com|twitter\.com|pinterest\.com|medium\.com|quora\.com)$/i;
const NON_PRODUCT_CONTENT_PATH =
  /\/(category|categories|search|collections?|support|help|careers|forums?|community)(\/|$)/i;

/**
 * Preserves the pre-capability shortlist admission policy.
 *
 * SourceType, PageType, and PageCapabilities describe how an admitted page may
 * contribute; they do not decide whether a search result may be enriched.
 */
export function mayEnterMetadataEnrichment(input: {
  url: string;
  sourceTier?: SearchCandidate['sourceTier'] | null;
}): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } catch {
    return false;
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (BLOCKED_HOST.test(host) || NON_PRODUCT_CONTENT_PATH.test(path)) return false;
  if (BRAND_CONTENT_PATH.test(path)) return true;
  if (COMPARISON_PATH.test(path) || COMPARISON_HOST.test(host)) return true;
  if (REVIEW_PATH.test(path) || REVIEW_HOST.test(host) || input.sourceTier === 'editorial') {
    return true;
  }

  return (
    input.sourceTier === 'official' ||
    input.sourceTier === 'marketplace' ||
    input.sourceTier === 'retailer'
  );
}
