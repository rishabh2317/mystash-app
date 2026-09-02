import type { Product } from '@/src/mocks/videos';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

function isHttpUrl(value: string | undefined): boolean {
  return Boolean(value && value.startsWith('http'));
}

/** Preview mapper for Home chips — Collection remains the full catalog SoT. */
export function mapFeedProductToCatalogViewModel(product: Product): CatalogProductViewModel {
  const catalogProductId = product.catalog_product_id?.trim() || null;
  const hero = isHttpUrl(product.image) ? product.image : CATALOG_IMAGE_PLACEHOLDER;
  return {
    id: product.id,
    catalogProductId,
    title: product.name,
    brand: null,
    merchant: product.provider ?? null,
    heroImage: hero,
    galleryImages: [hero],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: catalogProductId ? 'UNVERIFIED' : 'UNRESOLVED',
    availability: catalogProductId ? null : 'Shopping is not available yet',
    price: product.price && product.price !== '—' ? product.price : null,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  };
}

export function isFeedProductShopable(product: Product): boolean {
  return Boolean(product.catalog_product_id?.trim());
}
