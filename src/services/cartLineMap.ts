import type { CatalogProductViewModel, CatalogVerificationStatus } from '@/src/types/catalogProduct';

export type CartItemAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'NO_DESTINATION';

export type CartItemSource = {
  collectionId?: string | null;
  creatorId?: string | null;
  collectionProductTagId?: string | null;
  surface?: 'COLLECTION' | 'SEARCH' | 'PRODUCT_DETAILS' | 'OTHER' | 'USER_IMPORT' | null;
  contentSourceId?: string | null;
  userImportId?: string | null;
};

export type CartLine = {
  cartItemId: string;
  /** Membership id used for remove (catalog or discovered). */
  productId: string;
  /** Set only for catalogue-backed lines. Used for shopping redirect. */
  catalogProductId: string | null;
  addedAt: string;
  availability: CartItemAvailability;
  product: CatalogProductViewModel | null;
  source: CartItemSource | null;
};

function asVerification(value: unknown): CatalogVerificationStatus {
  if (value === 'VERIFIED' || value === 'UNVERIFIED' || value === 'UNRESOLVED') return value;
  return 'UNRESOLVED';
}

function asAvailability(value: unknown): CartItemAvailability {
  if (value === 'AVAILABLE' || value === 'UNAVAILABLE' || value === 'NO_DESTINATION') return value;
  return 'UNAVAILABLE';
}

function mapProduct(raw: unknown, fallbackCatalogId: string): CatalogProductViewModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id : fallbackCatalogId;
  const catalogProductId =
    typeof p.catalogProductId === 'string' ? p.catalogProductId : fallbackCatalogId;
  const title = typeof p.title === 'string' ? p.title : 'Product';
  return {
    id,
    catalogProductId,
    title,
    brand: typeof p.brand === 'string' ? p.brand : null,
    merchant: typeof p.merchant === 'string' ? p.merchant : null,
    heroImage: typeof p.heroImage === 'string' ? p.heroImage : null,
    galleryImages: Array.isArray(p.galleryImages)
      ? p.galleryImages.filter((u): u is string => typeof u === 'string')
      : [],
    description: typeof p.description === 'string' ? p.description : null,
    shortDescription: typeof p.shortDescription === 'string' ? p.shortDescription : null,
    specifications:
      p.specifications && typeof p.specifications === 'object' && !Array.isArray(p.specifications)
        ? Object.fromEntries(
            Object.entries(p.specifications as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
    verificationStatus: asVerification(p.verificationStatus),
    availability: typeof p.availability === 'string' ? p.availability : null,
    price: typeof p.price === 'string' ? p.price : null,
    currency: typeof p.currency === 'string' ? p.currency : null,
    lastVerifiedAt: typeof p.lastVerifiedAt === 'string' ? p.lastVerifiedAt : null,
    metadataCompleteness:
      typeof p.metadataCompleteness === 'number' ? p.metadataCompleteness : null,
    category: typeof p.category === 'string' && p.category.trim() ? p.category : null,
  };
}

function mapSource(raw: unknown): CartItemSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const source: CartItemSource = {
    collectionId: typeof s.collectionId === 'string' ? s.collectionId : null,
    creatorId: typeof s.creatorId === 'string' ? s.creatorId : null,
    collectionProductTagId:
      typeof s.collectionProductTagId === 'string' ? s.collectionProductTagId : null,
    surface:
      s.surface === 'COLLECTION' ||
      s.surface === 'SEARCH' ||
      s.surface === 'PRODUCT_DETAILS' ||
      s.surface === 'OTHER' ||
      s.surface === 'USER_IMPORT'
        ? s.surface
        : null,
    contentSourceId: typeof s.contentSourceId === 'string' ? s.contentSourceId : null,
    userImportId: typeof s.userImportId === 'string' ? s.userImportId : null,
  };
  if (
    !source.collectionId &&
    !source.creatorId &&
    !source.collectionProductTagId &&
    !source.surface &&
    !source.contentSourceId &&
    !source.userImportId
  ) {
    return null;
  }
  return source;
}

function mapLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const catalogProductId =
    typeof item.catalogProductId === 'string' && item.catalogProductId
      ? item.catalogProductId
      : null;
  const discoveredProductId =
    typeof item.discoveredProductId === 'string' && item.discoveredProductId
      ? item.discoveredProductId
      : null;
  const productId = catalogProductId ?? discoveredProductId;
  const cartItemId = typeof item.cartItemId === 'string' ? item.cartItemId : null;
  if (!productId || !cartItemId) return null;
  const product = mapProduct(item.product, productId);
  return {
    cartItemId,
    productId,
    catalogProductId,
    addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
    availability: asAvailability(item.availability),
    product: product
      ? {
          ...product,
          // Shopping is catalogue-only. Do not treat a discovered id as a catalog id.
          catalogProductId,
        }
      : null,
    source: mapSource(item.source),
  };
}

export function hydrateCartLines(raw: unknown[]): CartLine[] {
  return raw.map(mapLine).filter((x): x is CartLine => !!x);
}
