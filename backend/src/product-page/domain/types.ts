/** Unified Product Page projection. Storage type is not part of the DTO. */

export type ProductPageOfferAction = 'buy' | 'listing' | 'none';

export type ProductPageOffer = {
  id: string;
  merchant: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
  action: ProductPageOfferAction;
};

export type ProductPageSourceKind = 'reel' | 'short' | 'page';

export type ProductPageSource = {
  contentSourceId: string;
  userImportId: string | null;
  kind: ProductPageSourceKind;
  label: string;
  url: string;
  title: string | null;
  /** Published collection for in-app reel playback when the source URL is tagged. */
  collectionId: string | null;
};

export type ProductPageRelatedMediaCreator = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type ProductPageRelatedMedia = {
  id: string;
  kind: ProductPageSourceKind;
  label: string;
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
  collectionId: string | null;
  creator: ProductPageRelatedMediaCreator | null;
  views: number;
  saves: number;
  /** True when this tile is the user's original discovery source. */
  fromDiscovery?: boolean;
};

export type ProductPageReviewSource = {
  name: string;
  url: string;
};

/** READY catalogue AI review only. Rating/count stay null unless stored evidence exists. */
export type ProductPageReviews = {
  overview: string | null;
  likes: string[];
  concerns: string[];
  sources: ProductPageReviewSource[];
  rating: string | null;
  reviewCount: number | null;
};

export type ProductPageView = {
  productId: string;
  /** Catalogue id for ShoppingResolver / AI review. Null when shopping is listing-only. */
  shoppingProductId: string | null;
  title: string;
  brand: string | null;
  category: string | null;
  heroImage: string | null;
  galleryImages: string[];
  price: string | null;
  currency: string | null;
  merchant: string | null;
  description: string | null;
  specifications: Record<string, string>;
  offers: ProductPageOffer[];
  canShop: boolean;
  source: ProductPageSource | null;
  relatedMedia: ProductPageRelatedMedia[];
  reviews: ProductPageReviews | null;
  compareAvailable: boolean;
  /**
   * True while background merchant enrichment is still filling in details
   * for a user-imported discovered product. Always false for catalog products.
   */
  detailsUpdating: boolean;
};

export type ProductPageQuery = {
  contentSourceId?: string | null;
  userImportId?: string | null;
};
