import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CreatorPublishedProductDto } from '@/src/services/collectionApi';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

/** Map creator product list DTO → commerce view model (Collection remains full SoT). */
export function mapCreatorProductToCatalogViewModel(
  product: CreatorPublishedProductDto,
): CatalogProductViewModel {
  const hero =
    product.heroImage && product.heroImage.startsWith('http')
      ? product.heroImage
      : CATALOG_IMAGE_PLACEHOLDER;
  return {
    id: product.catalogProductId,
    catalogProductId: product.catalogProductId,
    title: product.title?.trim() || 'Product',
    brand: product.brand,
    merchant: null,
    heroImage: hero,
    galleryImages: [hero],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: product.verificationStatus,
    availability: null,
    price: product.price,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  };
}
