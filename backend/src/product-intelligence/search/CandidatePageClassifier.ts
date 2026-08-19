import type {
  CandidatePageType,
  PageCapabilities,
  PageType,
  SearchCandidate,
  SourceType,
} from '../domain/types';
import { capabilitiesFor } from './CandidateCapabilityRegistry';
import { EXACT_PRODUCT_PATH, isMarketplaceHost } from '../../shopping/productUrlIdentity';

export type CandidatePageClassification = {
  sourceType: SourceType;
  pageType: PageType;
  capabilities: PageCapabilities;
  reasons: string[];
  /** @deprecated Compatibility projection for persisted/debug payloads. */
  candidatePageType: CandidatePageType;
  /** @deprecated Descriptive compatibility projection; not an enrichment admission decision. */
  metadataEligible: boolean;
  /** @deprecated Use capabilities.commerce. */
  shoppingEligible: boolean;
};

const SPECIFICATION_HOST =
  /(^|\.)(gsmarena\.com|notebookcheck\.net|nanoreview\.net|phonearena\.com)$/i;
const COMPARISON_HOST =
  /(^|\.)(versus\.com|productchart\.com|gadgets360\.com)$/i;
const REVIEW_HOST =
  /(^|\.)(runnersworld\.com|theruntesters\.com|believeintherun\.com|rtings\.com|wirecutter\.com|reviewed\.com|tomsguide\.com|cnet\.com|techradar\.com|theverge\.com)$/i;
const NEWS_HOST =
  /(^|\.)(reuters\.com|bbc\.com|cnn\.com|bloomberg\.com|businessinsider\.com)$/i;
const FORUM_HOST = /(^|\.)(reddit\.com|xda-developers\.com|stackexchange\.com|quora\.com)$/i;
const SOCIAL_HOST =
  /(^|\.)(instagram\.com|facebook\.com|x\.com|twitter\.com|pinterest\.com|tiktok\.com)$/i;
const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;
const WIKI_HOST = /(^|\.)(wikipedia\.org|fandom\.com)$/i;

const PRODUCT_HTML_PATH = /\/[a-z0-9][a-z0-9-]{4,}\.html$/i;

function sourceTypeFrom(input: {
  host: string;
  expectedBrand?: string | null;
  sourceTier?: SearchCandidate['sourceTier'] | null;
}): SourceType {
  if (isMarketplaceHost(input.host)) return 'MARKETPLACE';
  if (COMPARISON_HOST.test(input.host)) return 'SPECIFICATION';
  if (SPECIFICATION_HOST.test(input.host)) return 'SPECIFICATION';
  if (REVIEW_HOST.test(input.host)) return 'REVIEW';
  if (NEWS_HOST.test(input.host)) return 'NEWS';
  if (FORUM_HOST.test(input.host)) return 'FORUM';
  if (SOCIAL_HOST.test(input.host)) return 'SOCIAL';
  if (VIDEO_HOST.test(input.host)) return 'VIDEO';
  if (WIKI_HOST.test(input.host)) return 'WIKI';

  const brandSlug = input.expectedBrand?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
  if (
    brandSlug.length >= 2 &&
    input.host.replace(/[^a-z0-9]+/g, '').includes(brandSlug)
  ) {
    return 'OFFICIAL';
  }
  if (input.sourceTier === 'official') return 'OFFICIAL';
  if (input.sourceTier === 'marketplace') return 'MARKETPLACE';
  if (input.sourceTier === 'editorial') return 'EDITORIAL';
  if (input.sourceTier === 'retailer') return 'RETAILER';
  return 'UNKNOWN';
}

function pageTypeFrom(input: {
  host: string;
  path: string;
  title: string;
  schemaType: string;
  openGraphType: string;
  sourceType: SourceType;
}): { pageType: PageType; reason: string } {
  const { host, path, title, sourceType } = input;
  if (COMPARISON_HOST.test(host)) {
    return { pageType: 'COMPARISON', reason: 'comparison_source' };
  }
  if (path === '/' || path === '') return { pageType: 'HOMEPAGE', reason: 'root_path' };
  if (
    /\bproduct\b/i.test(input.schemaType) ||
    /\bproduct\b/i.test(input.openGraphType)
  ) {
    return { pageType: 'PRODUCT', reason: 'structured_product_metadata' };
  }
  if (/\/(downloads?|drivers?|firmware)(\/|$)/i.test(path)) {
    return { pageType: 'DOWNLOAD', reason: 'download_path' };
  }
  if (/\/(manuals?|user-guides?)(\/|$)/i.test(path) || /\.pdf$/i.test(path)) {
    return { pageType: 'MANUAL', reason: 'manual_path' };
  }
  if (/\/(specifications?|specs?|technical-specs?)(\/|$)/i.test(path)) {
    return { pageType: 'SPECIFICATIONS', reason: 'specifications_path' };
  }
  if (/\/(search-results)(\/|$)/i.test(path)) {
    return { pageType: 'SEARCH_RESULTS', reason: 'search_results_path' };
  }
  if (/\/search(\/|$)/i.test(path)) return { pageType: 'SEARCH', reason: 'search_path' };
  if (/\/(category|categories|collections?)(\/|$)/i.test(path)) {
    return { pageType: 'CATEGORY', reason: 'category_path' };
  }
  if (/\/(support|help)(\/|$)/i.test(path)) {
    return { pageType: 'SUPPORT', reason: 'support_path' };
  }
  if (/\/(faq|faqs)(\/|$)/i.test(path)) return { pageType: 'FAQ', reason: 'faq_path' };
  if (/\/(forums?|community|threads?)(\/|$)/i.test(path) || sourceType === 'FORUM') {
    return { pageType: 'FORUM_THREAD', reason: 'forum_page' };
  }
  if (sourceType === 'VIDEO') return { pageType: 'VIDEO', reason: 'video_source' };
  if (sourceType === 'SOCIAL') {
    return /\/(reels?|video|watch)\b/i.test(path)
      ? { pageType: 'VIDEO', reason: 'social_video_path' }
      : { pageType: 'PROFILE', reason: 'social_profile' };
  }
  if (/\/(compare|comparison|versus|vs)(\/|[._-]|$)/i.test(path)) {
    return { pageType: 'COMPARISON', reason: 'comparison_path' };
  }
  if (/\/(buying-guide|buyers-guide|guides?)(\/|$)/i.test(path)) {
    return { pageType: 'BUYING_GUIDE', reason: 'buying_guide_path' };
  }
  if (/\/(reviews?|tested|testing)(\/|[-_]|$)/i.test(path) || sourceType === 'REVIEW') {
    return { pageType: 'REVIEW', reason: 'review_page' };
  }
  if (/\/(newsroom|news|press|press-releases?|releases?)(\/|$)/i.test(path)) {
    return { pageType: 'NEWS', reason: 'news_path' };
  }
  if (/\/(blog|blogs|stories|story|articles?)(\/|$)/i.test(path)) {
    return { pageType: 'EDITORIAL', reason: 'editorial_path' };
  }
  if (/\/(campaigns?|launch|events?)(\/|$)/i.test(path)) {
    return { pageType: 'CAMPAIGN', reason: 'campaign_path' };
  }
  if (EXACT_PRODUCT_PATH.test(path) || PRODUCT_HTML_PATH.test(path)) {
    return { pageType: 'PRODUCT', reason: 'product_url_pattern' };
  }
  if (/\b(review|tested)\b/i.test(title)) return { pageType: 'REVIEW', reason: 'review_title' };
  if (sourceType === 'SPECIFICATION') return { pageType: 'PRODUCT', reason: 'specification_source' };
  if (sourceType === 'NEWS') return { pageType: 'NEWS', reason: 'news_source' };
  if (sourceType === 'EDITORIAL' || sourceType === 'WIKI') {
    return { pageType: 'EDITORIAL', reason: 'editorial_source' };
  }
  if (sourceType === 'MARKETPLACE' || sourceType === 'RETAILER' || sourceType === 'OFFICIAL') {
    return { pageType: 'PRODUCT', reason: 'commerce_source_default' };
  }
  return { pageType: 'UNKNOWN', reason: 'unclassified' };
}

export function legacyCandidatePageType(
  sourceType: SourceType,
  pageType: PageType,
): CandidatePageType {
  if (sourceType === 'OFFICIAL' && pageType === 'PRODUCT') return 'official_product';
  if (sourceType === 'OFFICIAL' && (pageType === 'NEWS' || pageType === 'EDITORIAL')) {
    return 'official_brand_news';
  }
  if (sourceType === 'MARKETPLACE' && pageType === 'PRODUCT') return 'marketplace_pdp';
  if (pageType === 'COMPARISON') return 'comparison_site';
  if (
    pageType === 'REVIEW' ||
    pageType === 'BUYING_GUIDE' ||
    pageType === 'EDITORIAL' ||
    pageType === 'NEWS'
  ) {
    return 'review_site';
  }
  return 'retailer_pdp';
}

export function classifyCandidatePage(input: {
  url: string;
  sourceTier?: SearchCandidate['sourceTier'] | null;
  title?: string | null;
  expectedBrand?: string | null;
  schemaType?: string | null;
  openGraphType?: string | null;
}): CandidatePageClassification {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
  } catch {
    const capabilities = capabilitiesFor('UNKNOWN', 'UNKNOWN');
    return {
      sourceType: 'UNKNOWN',
      pageType: 'UNKNOWN',
      capabilities,
      reasons: ['invalid_url'],
      candidatePageType: 'review_site',
      metadataEligible: capabilities.metadata,
      shoppingEligible: capabilities.commerce,
    };
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  let sourceType = sourceTypeFrom({
    host,
    expectedBrand: input.expectedBrand,
    sourceTier: input.sourceTier,
  });
  const classifiedPage = pageTypeFrom({
    host,
    path: parsed.pathname.toLowerCase(),
    title: input.title ?? '',
    schemaType: input.schemaType ?? '',
    openGraphType: input.openGraphType ?? '',
    sourceType,
  });
  if (sourceType === 'UNKNOWN' && classifiedPage.pageType === 'PRODUCT') {
    sourceType = 'RETAILER';
  }
  const capabilities = capabilitiesFor(sourceType, classifiedPage.pageType);
  return {
    sourceType,
    pageType: classifiedPage.pageType,
    capabilities,
    reasons: [classifiedPage.reason],
    candidatePageType: legacyCandidatePageType(sourceType, classifiedPage.pageType),
    metadataEligible: capabilities.metadata,
    shoppingEligible: capabilities.commerce,
  };
}
