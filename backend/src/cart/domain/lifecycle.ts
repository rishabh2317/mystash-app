import type { CartItemSource, CartSourceSurface } from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SURFACES = new Set<CartSourceSurface>([
  'COLLECTION',
  'SEARCH',
  'PRODUCT_DETAILS',
  'OTHER',
]);

export function isValidCatalogProductId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 128) return false;
  if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes('..')) return false;
  return UUID_RE.test(trimmed);
}

export function normalizeCatalogProductId(id: string): string | null {
  const trimmed = id.trim();
  if (!isValidCatalogProductId(trimmed)) return null;
  return trimmed.toLowerCase();
}

function asUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Optional attribution — invalid fields dropped; empty → null. No search query text. */
export function normalizeCartSource(
  source: CartItemSource | null | undefined,
): {
  sourceCollectionId: string | null;
  sourceCreatorId: string | null;
  sourceCollectionProductTagId: string | null;
  sourceSurface: CartSourceSurface | null;
} | null {
  if (!source) return null;

  const sourceCollectionId = asUuid(source.collectionId);
  const sourceCreatorId = asUuid(source.creatorId);
  const sourceCollectionProductTagId = asUuid(source.collectionProductTagId);
  const surfaceRaw =
    typeof source.surface === 'string' ? source.surface.trim().toUpperCase() : null;
  const sourceSurface =
    surfaceRaw && SURFACES.has(surfaceRaw as CartSourceSurface)
      ? (surfaceRaw as CartSourceSurface)
      : null;

  if (
    !sourceCollectionId &&
    !sourceCreatorId &&
    !sourceCollectionProductTagId &&
    !sourceSurface
  ) {
    return null;
  }

  return {
    sourceCollectionId,
    sourceCreatorId,
    sourceCollectionProductTagId,
    sourceSurface,
  };
}

export function sourceFromRecord(record: {
  sourceCollectionId: string | null;
  sourceCreatorId: string | null;
  sourceCollectionProductTagId: string | null;
  sourceSurface: CartSourceSurface | null;
}): CartItemSource | null {
  if (
    !record.sourceCollectionId &&
    !record.sourceCreatorId &&
    !record.sourceCollectionProductTagId &&
    !record.sourceSurface
  ) {
    return null;
  }
  return {
    collectionId: record.sourceCollectionId,
    creatorId: record.sourceCreatorId,
    collectionProductTagId: record.sourceCollectionProductTagId,
    surface: record.sourceSurface,
  };
}

/**
 * Whether a Catalog status may be newly added to Cart.
 * MERGED is handled by resolveActiveProduct before this check.
 * HIDDEN / DISCONTINUED / missing → reject on add.
 */
export function isCartableStatus(status: string): boolean {
  return status === 'ACTIVE';
}

export function hasShoppingDestinationHint(product: {
  preferredShoppingUrl?: string | null;
  merchantUrl?: string | null;
  affiliateUrl?: string | null;
}): boolean {
  return Boolean(
    product.preferredShoppingUrl?.trim() ||
      product.merchantUrl?.trim() ||
      product.affiliateUrl?.trim(),
  );
}
