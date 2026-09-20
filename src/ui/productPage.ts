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
import { formatProductPrice } from '@/src/ui/collectionSections';

export const PRODUCT_PAGE_COPY = {
  buy: 'Buy',
  viewListing: 'Buy',
  foundFrom: 'Found from',
  discovery: 'Your discovery',
  relatedMedia: 'More about this product',
  reviews: 'Reviews',
  summary: 'Summary',
  likes: 'What people like',
  concerns: 'Common concerns',
  readReviews: 'Read full review',
  viewSource: 'View source',
  similar: 'Similar products',
  compare: 'Compare',
  compareHint: 'See how this product differs from others.',
  details: 'Details',
  specs: 'Specifications',
  offers: 'Where can I buy this?',
  soldBy: 'Sold by',
  unavailable: 'Unavailable',
  loadError: 'Couldn’t load this product',
  retry: 'Retry',
} as const;

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

export function productPageSections(page: ProductPageView): {
  offers: boolean;
  source: boolean;
  relatedMedia: boolean;
  reviews: boolean;
  similar: boolean;
  compare: boolean;
  description: boolean;
  specs: boolean;
} {
  return {
    offers: page.offers.length > 0,
    source: Boolean(page.source),
    relatedMedia: page.relatedMedia.length > 0,
    reviews: Boolean(page.reviews),
    similar: Boolean(page.shoppingProductId),
    compare: true,
    description: Boolean(page.description?.trim()),
    specs: Object.keys(page.specifications).length > 0,
  };
}

export function catalogViewFromProductPage(page: ProductPageView): CatalogProductViewModel {
  return {
    id: page.productId,
    catalogProductId: page.shoppingProductId,
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
  if (!page.reviews || !page.shoppingProductId) return null;
  return {
    status: 'available',
    summary: {
      catalogProductId: page.shoppingProductId,
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

export function relatedMediaPath(item: ProductPageRelatedMedia): string | null {
  const collectionId = item.collectionId?.trim();
  return collectionId ? `/reel/${collectionId}` : null;
}

export type { ProductPageRelatedMedia, ProductPageSource, ProductPageView };
