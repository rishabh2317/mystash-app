import type {
  ProductPageOffer,
  ProductPageRelatedMedia,
  ProductPageReviews,
  ProductPageSource,
  ProductPageSourceKind,
  ProductPageView,
} from '@/src/types/productPage';
import type { ProductAiReviewResult } from '@/src/types/productAiReview';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import { formatProductPrice } from '@/src/ui/collectionSections';
import { getYouTubeThumbnailUrl } from '@/src/utils/videoUtils';

export const PRODUCT_PAGE_COPY = {
  buy: 'Buy',
  viewListing: 'Buy',
  foundFrom: 'Found from',
  discovery: 'Your discovery',
  discoveryHint: 'You discovered this',
  discoveryTag: 'You found this',
  viewOriginal: 'View original',
  relatedMedia: 'Featured',
  reviews: 'Reviews',
  summary: 'Summary',
  likes: 'What people like',
  concerns: 'Common concerns',
  readReviews: 'Read full review',
  seeReviewSources: 'See review sources',
  viewSource: 'View source',
  similar: 'You might also like',
  compare: 'Compare',
  compareHint: 'See how this product differs from others.',
  details: 'Details',
  specs: 'Specifications',
  offers: 'Where to get it',
  pricesFrom: 'Prices from',
  bestPrice: 'Best available price',
  pricesCheckedNow: 'Prices checked just now',
  soldBy: 'Sold by',
  unavailable: 'Unavailable',
  loadError: 'Couldn’t load this product',
  retry: 'Retry',
  priceUpdating: 'Checking live price…',
  priceLive: 'Updated just now',
  priceStale: 'Last checked — not recently verified',
  detailsUpdating: 'Updating details…',
  inYourStash: 'In your Stash',
  aiInsight: 'Mystash insight',
  aiInsightTeaser: 'A clear take on what people are saying',
  aiInsightCta: 'Read the review',
} as const;

/** Poll interval while Product Page details are still being filled in. */
export const PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS = 2500;

export function shouldPollProductPageDetails(
  page: Pick<ProductPageView, 'detailsUpdating'> | null | undefined,
): boolean {
  return page?.detailsUpdating === true;
}

export function productPagePath(
  productId: string,
  attrs?: { contentSourceId?: string | null; userImportId?: string | null },
): string {
  const id = productId.trim();
  const query = new URLSearchParams();
  if (attrs?.contentSourceId?.trim()) query.set('contentSourceId', attrs.contentSourceId.trim());
  if (attrs?.userImportId?.trim()) query.set('userImportId', attrs.userImportId.trim());
  const suffix = query.toString();
  return `/product/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ''}`;
}

export function productPagePriceLabel(page: Pick<ProductPageView, 'price' | 'currency'>): string | null {
  return formatProductPrice({
    id: 'price',
    catalogProductId: null,
    title: '',
    brand: null,
    merchant: null,
    heroImage: null,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNRESOLVED',
    availability: null,
    price: page.price,
    currency: page.currency,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  });
}

export function productPageOfferCta(offer: ProductPageOffer): string | null {
  if (offer.action === 'buy' || offer.action === 'listing') return PRODUCT_PAGE_COPY.buy;
  return null;
}

export function productPageAvailabilityLabel(offer: ProductPageOffer): string | null {
  if (offer.action === 'none' && !offer.availability) return PRODUCT_PAGE_COPY.unavailable;
  return offer.availability;
}

export function productPagePriceFreshnessLabel(
  freshness: 'loading' | 'live' | 'stale' | 'stored',
): string | null {
  if (freshness === 'loading') return PRODUCT_PAGE_COPY.priceUpdating;
  if (freshness === 'live') return PRODUCT_PAGE_COPY.priceLive;
  if (freshness === 'stale') return PRODUCT_PAGE_COPY.priceStale;
  return null;
}

export function productPageSections(page: ProductPageView): {
  offers: boolean;
  source: boolean;
  relatedMedia: boolean;
  featured: boolean;
  reviews: boolean;
  similar: boolean;
  compare: boolean;
  description: boolean;
  specs: boolean;
} {
  const hasSource = Boolean(page.source);
  const hasRelated = page.relatedMedia.length > 0;
  return {
    offers: page.offers.length > 0,
    source: hasSource,
    relatedMedia: hasRelated,
    featured: hasSource || hasRelated,
    reviews: Boolean(page.reviews),
    similar: Boolean(page.shoppingProductId),
    compare: page.compareAvailable === true,
    description: Boolean(page.description?.trim()),
    specs: Object.keys(page.specifications).length > 0,
  };
}

/** Lowest priced offer label among those with a parseable price — for “Prices from …”. */
export function productPagePricesFromLabel(
  offers: Array<Pick<ProductPageOffer, 'price' | 'currency'>>,
): string | null {
  let best: { price: string; currency: string | null; value: number } | null = null;
  for (const offer of offers) {
    if (!offer.price?.trim()) continue;
    const value = Number.parseFloat(offer.price.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (!best || value < best.value) {
      best = { price: offer.price, currency: offer.currency, value };
    }
  }
  if (!best) return null;
  const formatted = productPagePriceLabel({ price: best.price, currency: best.currency });
  return formatted ? `${PRODUCT_PAGE_COPY.pricesFrom} ${formatted}` : null;
}

/**
 * “Best available price …” only when ≥2 priced offers and a clear lowest.
 * Otherwise null (caller can fall back to prices-from).
 */
export function productPageBestPriceLabel(
  offers: Array<Pick<ProductPageOffer, 'price' | 'currency'>>,
): string | null {
  const priced = offers
    .map((offer) => {
      if (!offer.price?.trim()) return null;
      const value = Number.parseFloat(offer.price.replace(/,/g, ''));
      if (!Number.isFinite(value)) return null;
      return { price: offer.price, currency: offer.currency, value };
    })
    .filter((row): row is { price: string; currency: string | null; value: number } => Boolean(row));
  if (priced.length < 2) return null;
  priced.sort((a, b) => a.value - b.value);
  if (priced[0]!.value >= priced[1]!.value) return null;
  const formatted = productPagePriceLabel({
    price: priced[0]!.price,
    currency: priced[0]!.currency,
  });
  return formatted ? `${PRODUCT_PAGE_COPY.bestPrice} ${formatted}` : null;
}

export function productPageBuyingFreshnessLine(
  freshnessList: Array<'loading' | 'live' | 'stale' | 'stored'>,
): string | null {
  if (freshnessList.some((f) => f === 'loading')) return PRODUCT_PAGE_COPY.priceUpdating;
  if (freshnessList.some((f) => f === 'live')) return PRODUCT_PAGE_COPY.pricesCheckedNow;
  if (freshnessList.some((f) => f === 'stale')) return PRODUCT_PAGE_COPY.priceStale;
  return null;
}

export function catalogViewFromProductPage(page: ProductPageView): CatalogProductViewModel {
  return {
    id: page.productId,
    // Catalogue shopping id when present; otherwise discovered id for on-demand AI Review.
    catalogProductId: page.shoppingProductId ?? page.productId,
    title: page.title,
    brand: page.brand,
    merchant: page.merchant,
    heroImage: page.heroImage,
    galleryImages: page.galleryImages,
    description: page.description,
    shortDescription: null,
    specifications: page.specifications,
    verificationStatus: 'UNRESOLVED',
    availability: null,
    price: page.price,
    currency: page.currency,
    lastVerifiedAt: null,
    metadataCompleteness: null,
    category: page.category,
  };
}

export function similarProductsQuery(page: ProductPageView): string | null {
  const brand = page.brand?.trim();
  const title = page.title.trim();
  if (brand && title) return `${brand} ${title}`;
  if (title) return title;
  return null;
}

export function productPageRatingLabel(reviews: ProductPageReviews): string | null {
  const rating = reviews.rating?.trim();
  if (!rating) return null;
  if (typeof reviews.reviewCount === 'number' && reviews.reviewCount > 0) {
    return `${rating} · ${reviews.reviewCount.toLocaleString()} reviews`;
  }
  return rating;
}

export function productAiReviewFromPage(page: ProductPageView): ProductAiReviewResult | null {
  const subjectId = page.shoppingProductId ?? page.productId;
  if (!page.reviews || !subjectId) return null;
  return {
    status: 'available',
    summary: {
      catalogProductId: subjectId,
      overview: page.reviews.overview,
      pros: page.reviews.likes,
      cons: page.reviews.concerns,
      sources: page.reviews.sources,
    },
  };
}

export function relatedMediaWatchLabel(kind: ProductPageSourceKind): string {
  if (kind === 'reel') return 'Watch on Instagram';
  if (kind === 'short') return 'Watch on YT';
  return 'Open link';
}

/** In-app reel path when discovery/featured media is a published collection. */
export function relatedMediaPath(item: Pick<ProductPageRelatedMedia, 'collectionId'>): string | null {
  const collectionId = item.collectionId?.trim();
  return collectionId ? `/reel/${collectionId}` : null;
}

export function discoverySourcePath(source: ProductPageSource): string | null {
  return relatedMediaPath(source);
}

export function discoveryWatchLabel(source: Pick<ProductPageSource, 'kind' | 'collectionId'>): string {
  if (source.collectionId?.trim()) return 'Play';
  return relatedMediaWatchLabel(source.kind);
}

/** Poster for discovery / featured tiles — stored thumb, else YouTube hqdefault. */
export function relatedMediaPosterUrl(item: {
  url: string;
  thumbnailUrl?: string | null;
}): string | null {
  const stored = item.thumbnailUrl?.trim();
  if (stored) return stored;
  return getYouTubeThumbnailUrl(item.url, 'high');
}

/** Build Featured rail: original discovery first (tagged), then other related media. */
export function featuredMediaFromPage(page: ProductPageView): ProductPageRelatedMedia[] {
  const out: ProductPageRelatedMedia[] = [];
  const source = page.source;
  if (source) {
    out.push({
      id: `discovery:${source.contentSourceId}`,
      kind: source.kind,
      label: source.label,
      url: source.url,
      title: source.title?.trim() || source.label,
      thumbnailUrl: null,
      collectionId: source.collectionId,
      creator: null,
      views: 0,
      saves: 0,
      fromDiscovery: true,
    });
  }
  const sourceKey = source?.url ? mediaUrlKey(source.url) : '';
  for (const item of page.relatedMedia) {
    if (sourceKey && mediaUrlKey(item.url) === sourceKey) continue;
    if (source?.collectionId && item.collectionId === source.collectionId) {
      // Prefer the tagged discovery tile when the same collection is the source.
      continue;
    }
    out.push({ ...item, fromDiscovery: false });
  }
  return out;
}

function mediaUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Adapt Product Page related media into CollectionTile's CollectionViewModel. */
export function collectionViewFromRelatedMedia(
  item: ProductPageRelatedMedia,
): CollectionViewModel {
  return {
    collectionId: item.collectionId?.trim() || item.id,
    slug: item.id,
    title: item.title?.trim() || item.label,
    heroThumbnailUrl: relatedMediaPosterUrl(item),
    productCount: 0,
    publishedAt: null,
    creator: item.creator
      ? {
          id: item.creator.id,
          username: item.creator.username,
          displayName: item.creator.displayName,
          avatarUrl: item.creator.avatarUrl,
        }
      : {
          id: '',
          username: null,
          displayName: null,
          avatarUrl: null,
        },
    counters: {
      views: Math.max(0, Math.floor(item.views ?? 0)),
      saves: Math.max(0, Math.floor(item.saves ?? 0)),
    },
  };
}

export type { ProductPageRelatedMedia, ProductPageSource, ProductPageView };
