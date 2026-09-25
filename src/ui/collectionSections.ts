import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';

/**
 * Collection page section copy + derived labels.
 * Every value here is derived from real Collection data — no placeholders.
 */
export const COLLECTION_SECTION_COPY = {
  productsSectionSuffix: 'in this collection',
  curatedBy: 'Curated by',
  productInsights: 'Product insights',
  aiReview: 'AI Review',
  aiReviewBeta: 'Beta',
  readFullReview: 'Read full AI review',
  viewProductDetails: 'View product details',
  viewMoreMerchants: 'View more',
  buyingOptions: 'Buying options',
  shopOption: 'Shop',
  soldBy: 'Sold by',
  lastVerified: 'Last verified',
  trust: 'Verification',
  exploreMore: 'Explore more',
  shopMoreCollections: 'Shop more collections',
  shopMoreCollectionsHint: 'Find more picks from this creator',
  saveCollection: 'Save this collection',
  saveCollectionHint: 'Add to your Bag for later',
  savedCollection: 'Saved to your Bag',
  savedCollectionHint: 'Tap to remove from saved',
  aiReviewGenerating: 'Analysing product specs, reviews and expert sources…',
  /**
   * Shown for the `unavailable` state. The API's own message can be a raw
   * provider error ("Gemini request failed"), which is diagnostics, not copy.
   */
  aiReviewUnavailable: 'An AI Review is not available for this product yet.',
  showMore: 'More',
  showLess: 'Less',
  whatWeLike: 'What we like',
  thingsToConsider: 'Things to consider',
  evidenceAndSources: 'Evidence & sources',
} as const;

/** Short, human date for `publishedAt` / `lastVerifiedAt`. Null when unknown. */
export function formatCollectionDate(iso: string | null | undefined): string | null {
  const value = iso?.trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export function productCountLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return `${n} Product${n === 1 ? '' : 's'}`;
}

/** Section title for the Collection's own products, e.g. "3 Products in this collection". */
export function productsSectionTitle(count: number): string {
  return `${productCountLabel(count)} ${COLLECTION_SECTION_COPY.productsSectionSuffix}`;
}

export type CollectionMetaItem = {
  id: 'products' | 'views' | 'created';
  icon: 'pricetag-outline' | 'eye-outline' | 'calendar-outline';
  label: string;
};

/**
 * Hero metadata strip. Only emits entries the Collection actually has:
 * product count, view count and publish date.
 */
export function collectionMetaItems(
  collection: CollectionDetailViewModel,
): CollectionMetaItem[] {
  const items: CollectionMetaItem[] = [
    {
      id: 'products',
      icon: 'pricetag-outline',
      label: productCountLabel(collection.products.length),
    },
  ];

  const views = Math.max(0, Math.floor(collection.counters?.views ?? 0));
  if (views > 0) {
    items.push({
      id: 'views',
      icon: 'eye-outline',
      label: `${formatEngagementCount(views)} View${views === 1 ? '' : 's'}`,
    });
  }

  const created = formatCollectionDate(collection.publishedAt);
  if (created) {
    items.push({ id: 'created', icon: 'calendar-outline', label: `Created ${created}` });
  }

  return items;
}

/** Multi-product Collections group product intelligence under its own heading. */
export function shouldGroupProductInsights(productCount: number): boolean {
  return productCount > 1;
}

export type CollectionVerificationSummary = {
  verified: number;
  total: number;
  /** Most recent `lastVerifiedAt` across products, if any. */
  lastVerifiedAt: string | null;
};

/** Trust strip data, derived only from catalog verification fields. */
export function collectionVerificationSummary(
  products: CatalogProductViewModel[],
): CollectionVerificationSummary {
  const verified = products.filter((p) => p.verificationStatus === 'VERIFIED').length;
  const lastVerifiedAt = products.reduce<string | null>((latest, product) => {
    const value = product.lastVerifiedAt?.trim();
    if (!value) return latest;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return latest;
    if (!latest) return value;
    return time > new Date(latest).getTime() ? value : latest;
  }, null);
  return { verified, total: products.length, lastVerifiedAt };
}

/** Factual verification sentence — never an authenticity or warranty claim. */
export function verificationSummaryLabel(summary: CollectionVerificationSummary): string | null {
  if (summary.total === 0) return null;
  if (summary.verified === 0) return 'Product details are still being verified.';
  if (summary.verified === summary.total) {
    return summary.total === 1
      ? 'This product was matched to its merchant listing and verified.'
      : `All ${summary.total} products were matched to their merchant listings and verified.`;
  }
  return `${summary.verified} of ${summary.total} products verified against merchant listings.`;
}

/**
 * Price as shown on cards: currency prefix only when the API supplied one and
 * the price string does not already carry it — some merchants return
 * "USD 18,000.00", which would otherwise render as "USD USD 18,000.00".
 */
export function formatProductPrice(product: CatalogProductViewModel): string | null {
  const price = product.price?.trim();
  if (!price || price === '—') return null;
  const currency = product.currency?.trim();
  if (!currency) return price;
  const alreadyPrefixed = price.slice(0, currency.length).toUpperCase() === currency.toUpperCase();
  return alreadyPrefixed ? price : `${currency} ${price}`;
}

/** Buying-option row on Collection product cards (no client-side merchant URLs). */
export type CollectionMerchantPreview = {
  id: string;
  label: string;
  /** Formatted price when the offer provided one. */
  priceLabel?: string | null;
};

/** How many buying options to preview before “View more”. */
export const COLLECTION_MERCHANT_PREVIEW_LIMIT = 3;

export function merchantLabelFromUrl(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

function formatOfferPrice(price: string | null | undefined, currency: string | null | undefined): string | null {
  const raw = price?.trim();
  if (!raw || raw === '—') return null;
  const cur = currency?.trim();
  if (!cur) return raw;
  const alreadyPrefixed = raw.slice(0, cur.length).toUpperCase() === cur.toUpperCase();
  return alreadyPrefixed ? raw : `${cur} ${raw}`;
}

/** Fallback rows from catalog fields when Product Page offers are not loaded yet. */
export function collectionMerchantPreviewsFromProduct(
  product: Pick<CatalogProductViewModel, 'merchant' | 'price' | 'currency'> & {
    merchantUrl?: string | null;
  },
): CollectionMerchantPreview[] {
  const fromUrl = merchantLabelFromUrl(product.merchantUrl);
  const fromName = product.merchant?.trim() || null;
  const priceLabel = formatProductPrice(product as CatalogProductViewModel);
  if (fromName && fromUrl && fromName.toLowerCase() !== fromUrl.toLowerCase()) {
    return [
      { id: 'merchant-name', label: fromName, priceLabel },
      { id: 'merchant-url', label: fromUrl, priceLabel: null },
    ];
  }
  if (fromName) return [{ id: 'merchant-name', label: fromName, priceLabel }];
  if (fromUrl) return [{ id: 'merchant-url', label: fromUrl, priceLabel }];
  return [];
}

/**
 * Prefer real offer merchants (with prices). Keeps unnamed offers when they still
 * have a price so the card can show multiple buying options.
 */
export function collectionMerchantPreviewsFromOffers(
  offers: ReadonlyArray<{
    id: string;
    merchant: string | null;
    price?: string | null;
    currency?: string | null;
    action?: string | null;
  }>,
): CollectionMerchantPreview[] {
  const out: CollectionMerchantPreview[] = [];
  const seen = new Set<string>();
  for (const offer of offers) {
    if (offer.action === 'none') continue;
    const label = offer.merchant?.trim() || null;
    const priceLabel = formatOfferPrice(offer.price, offer.currency);
    if (!label && !priceLabel) continue;
    const display = label || COLLECTION_SECTION_COPY.shopOption;
    const key = `${display.toLowerCase()}|${priceLabel ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: offer.id, label: display, priceLabel });
  }
  return out;
}

