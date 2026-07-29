import type { CandidatePageType, SearchCandidate } from '../domain/types';

export type CandidatePageClassification = {
  pageType: CandidatePageType;
  metadataEligible: boolean;
  shoppingEligible: boolean;
  reasons: string[];
};

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
 * Classifies how a page may be used. Source authority alone never grants
 * commerce eligibility: an official newsroom can enrich metadata but cannot
 * become a shopping destination.
 */
export function classifyCandidatePage(input: {
  url: string;
  sourceTier?: SearchCandidate['sourceTier'] | null;
}): CandidatePageClassification {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
  } catch {
    return {
      pageType: 'review_site',
      metadataEligible: false,
      shoppingEligible: false,
      reasons: ['invalid_url'],
    };
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (BLOCKED_HOST.test(host) || NON_PRODUCT_CONTENT_PATH.test(path)) {
    return {
      pageType: 'review_site',
      metadataEligible: false,
      shoppingEligible: false,
      reasons: ['blocked_content'],
    };
  }
  if (BRAND_CONTENT_PATH.test(path)) {
    return {
      pageType: input.sourceTier === 'official' ? 'official_brand_news' : 'review_site',
      metadataEligible: true,
      shoppingEligible: false,
      reasons: ['content_path'],
    };
  }
  if (COMPARISON_PATH.test(path) || COMPARISON_HOST.test(host)) {
    return {
      pageType: 'comparison_site',
      metadataEligible: true,
      shoppingEligible: false,
      reasons: ['comparison_page'],
    };
  }
  if (REVIEW_PATH.test(path) || REVIEW_HOST.test(host) || input.sourceTier === 'editorial') {
    return {
      pageType: 'review_site',
      metadataEligible: true,
      shoppingEligible: false,
      reasons: ['review_page'],
    };
  }
  if (input.sourceTier === 'official') {
    return {
      pageType: 'official_product',
      metadataEligible: true,
      shoppingEligible: true,
      reasons: ['official_product_page'],
    };
  }
  if (input.sourceTier === 'marketplace') {
    return {
      pageType: 'marketplace_pdp',
      metadataEligible: true,
      shoppingEligible: true,
      reasons: ['marketplace_product_page'],
    };
  }
  return {
    pageType: 'retailer_pdp',
    metadataEligible: true,
    shoppingEligible: true,
    reasons: ['retailer_product_page'],
  };
}
