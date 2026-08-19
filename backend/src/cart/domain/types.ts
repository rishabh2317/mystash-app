/** Cart domain types — membership SoT; Catalog remains Product SoT. */

export type CartSourceSurface = 'COLLECTION' | 'SEARCH' | 'PRODUCT_DETAILS' | 'OTHER';

export type CartItemSource = {
  collectionId?: string | null;
  creatorId?: string | null;
  collectionProductTagId?: string | null;
  surface?: CartSourceSurface | null;
};

export type CartItemRecord = {
  id: string;
  userId: string;
  catalogProductId: string;
  addedAt: string;
  updatedAt: string;
  sourceCollectionId: string | null;
  sourceCreatorId: string | null;
  sourceCollectionProductTagId: string | null;
  sourceSurface: CartSourceSurface | null;
  schemaVersion: number;
};

/** FE-aligned Catalog projection embedded on GET /cart (not Cart-owned SoT). */
export type CartProductProjection = {
  id: string;
  catalogProductId: string;
  title: string;
  brand: string | null;
  merchant: string | null;
  heroImage: string | null;
  galleryImages: string[];
  description: string | null;
  shortDescription: string | null;
  specifications: Record<string, string>;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';
  availability: string | null;
  price: string | null;
  currency: string | null;
  lastVerifiedAt: string | null;
  metadataCompleteness: number | null;
};

export type CartItemAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'NO_DESTINATION';

export type CartItemView = {
  cartItemId: string;
  catalogProductId: string;
  addedAt: string;
  source: CartItemSource | null;
  availability: CartItemAvailability;
  product: CartProductProjection | null;
};

export type CartView = {
  items: CartItemView[];
  itemCount: number;
};

export type AddCartItemInput = {
  catalogProductId: string;
  source?: CartItemSource | null;
};

export type RemoveCartItemReason = 'user_remove' | 'purchase_confirmed';

export type AddCartItemResult = {
  item: CartItemRecord;
  created: boolean;
};
