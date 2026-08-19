import { EXACT_PRODUCT_PATH, isMarketplaceHost } from '../../shopping/productUrlIdentity';

export type PdpVerdict = 'pdp' | 'not_pdp' | 'uncertain';

export type PdpClassification = {
  verdict: PdpVerdict;
  score: number;
  hardNegative: boolean;
  reasons: string[];
  signals: Record<string, boolean | number | string>;
  sourceTier: 'official' | 'marketplace' | 'retailer' | 'editorial';
};

export type PdpClassifierInput = {
  url: string;
  title?: string | null;
  snippet?: string | null;
  expectedBrand?: string | null;
  metadata?: {
    hasProductJsonLd?: boolean;
    hasOffer?: boolean;
    price?: string | null;
    sku?: string | null;
    hasAddToCart?: boolean;
    hasVariantSelectors?: boolean;
    productImage?: string | null;
    specifications?: Record<string, string> | null;
    merchantProductMetadata?: boolean;
  };
};

const NEGATIVE_PATH =
  /\/(blog|blogs|news|stories|story|support|help|guide|guides|careers|category|categories|search|collections?|articles?|reviews?|compare|forums?|community|manuals?|downloads?)(\/|$)/i;
const NEGATIVE_HOST =
  /(^|\.)(youtube\.com|youtu\.be|reddit\.com|wikipedia\.org|facebook\.com|instagram\.com|x\.com|twitter\.com|pinterest\.com|medium\.com|quora\.com|support\.apple\.com)$/i;
const NEGATIVE_TITLE = /\b(blog|buying guide|how to|support|help center|search results|collection|category|careers)\b/i;
const SKU_HTML_PATH = /\/[a-z0-9][a-z0-9-]{4,}\.html$/i;
const EDITORIAL_HOST =
  /(^|\.)(believeintherun\.com|rtings\.com|wirecutter\.com|reviewed\.com|tomsguide\.com|cnet\.com|techradar\.com|theverge\.com)$/i;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Provider-independent, reusable PDP classifier for pre/post enrichment. */
export function classifyPdp(input: PdpClassifierInput): PdpClassification {
  const reasons: string[] = [];
  const signals: Record<string, boolean | number | string> = {};
  let parsed: URL;
  try {
    parsed = new URL(input.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
  } catch {
    return {
      verdict: 'not_pdp',
      score: 0,
      hardNegative: true,
      reasons: ['invalid_url'],
      signals: { validUrl: false },
      sourceTier: 'editorial',
    };
  }

  const path = parsed.pathname.toLowerCase();
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const title = `${input.title ?? ''} ${input.snippet ?? ''}`.trim();
  const brandSlug = input.expectedBrand?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
  const official =
    brandSlug.length >= 2 && host.replace(/[^a-z0-9]/g, '').includes(brandSlug);
  const sourceTier = official
    ? 'official'
    : isMarketplaceHost(host)
      ? 'marketplace'
      : EDITORIAL_HOST.test(host)
        ? 'editorial'
        : 'retailer';
  if (NEGATIVE_HOST.test(host)) reasons.push('blocked_host');
  if (NEGATIVE_PATH.test(path)) reasons.push('negative_path');
  if (NEGATIVE_TITLE.test(title)) reasons.push('editorial_or_listing_title');
  const hardNegative = reasons.length > 0;
  if (hardNegative) {
    return {
      verdict: 'not_pdp',
      score: 0,
      hardNegative: true,
      reasons,
      signals: { host, path, negativePath: NEGATIVE_PATH.test(path) },
      sourceTier,
    };
  }

  const m = input.metadata ?? {};
  let score = 0;
  const add = (condition: boolean, weight: number, reason: string) => {
    signals[reason] = condition;
    if (condition) {
      score += weight;
      reasons.push(reason);
    }
  };
  add(Boolean(m.hasProductJsonLd), 0.35, 'product_schema');
  add(Boolean(m.hasOffer), 0.12, 'offer');
  add(Boolean(m.price), 0.14, 'price');
  add(Boolean(m.sku), 0.1, 'sku');
  add(Boolean(m.hasAddToCart), 0.14, 'add_to_cart');
  add(Boolean(m.hasVariantSelectors), 0.06, 'variant_selectors');
  add(Boolean(m.productImage), 0.06, 'product_image');
  add(Boolean(m.specifications && Object.keys(m.specifications).length), 0.06, 'specifications');
  add(Boolean(m.merchantProductMetadata), 0.15, 'merchant_product_metadata');
  add(EXACT_PRODUCT_PATH.test(path), 0.2, 'product_url_pattern');
  add(SKU_HTML_PATH.test(path), 0.2, 'sku_url_pattern');
  add(official, 0.2, 'official_brand_domain');
  add(Boolean(input.title?.trim() && input.title.trim().length >= 4), 0.06, 'product_title');

  score = clamp01(score);
  return {
    verdict: score >= 0.45 ? 'pdp' : 'uncertain',
    score,
    hardNegative: false,
    reasons: reasons.length ? reasons : ['insufficient_pdp_signals'],
    signals: { ...signals, host, path },
    sourceTier,
  };
}
