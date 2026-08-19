import type { CatalogProduct } from '../product-intelligence/domain/types';
import type { CartProductProjection } from './domain/types';

/**
 * Thin Catalog → Cart read port.
 * Cart never writes Catalog.
 */
export type CatalogCartPort = {
  resolveActiveProduct(id: string): Promise<CatalogProduct | null>;
  getById(id: string): Promise<CatalogProduct | null>;
  getProductsByIds(ids: string[]): Promise<Map<string, CatalogProduct>>;
};

export function mapCatalogToCartProjection(product: CatalogProduct): CartProductProjection {
  const specs: Record<string, string> = {};
  const meta = product.metadata ?? {};
  if (meta && typeof meta === 'object') {
    const rawSpecs = (meta as { specifications?: unknown }).specifications;
    if (rawSpecs && typeof rawSpecs === 'object' && !Array.isArray(rawSpecs)) {
      for (const [k, v] of Object.entries(rawSpecs as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) specs[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') specs[k] = String(v);
      }
    }
  }

  const completeness =
    typeof meta.metadataCompleteness === 'number'
      ? meta.metadataCompleteness
      : typeof meta.completeness === 'number'
        ? meta.completeness
        : null;

  return {
    id: product.id,
    catalogProductId: product.id,
    title: product.name,
    brand: product.brand,
    merchant: product.merchant,
    heroImage: product.imageUrl,
    galleryImages: product.imageUrl ? [product.imageUrl] : [],
    description: product.description,
    shortDescription: null,
    specifications: specs,
    verificationStatus: product.verificationStatus,
    availability: null,
    price: product.price,
    currency: product.currency,
    lastVerifiedAt: product.lastVerifiedAt,
    metadataCompleteness: completeness,
  };
}
