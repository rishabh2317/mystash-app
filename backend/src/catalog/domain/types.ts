/**
 * Catalog domain types — re-export canonical shapes from the shared product-intelligence
 * type module (same tables / identity model). Catalog BC owns the application boundary.
 */
export type {
  CatalogProduct,
  CatalogStatus,
  CreateCatalogInput,
  UpdateCatalogInput,
  VerificationStatus,
  NormalizedProduct,
} from '../../product-intelligence/domain/types';

export type ShoppingProjection = {
  preferredShoppingUrl?: string | null;
  shoppingProvider?: string | null;
  affiliateUrl?: string | null;
  price?: string | null;
  currency?: string | null;
};

export type UnresolvedPlaceholderInput = {
  draftId: string;
  name: string;
  normalizedName?: string | null;
  imageUrl?: string | null;
  merchantUrl?: string | null;
  price?: string | null;
};

export type LifecycleAction = 'hide' | 'unhide' | 'discontinue' | 'restore';
