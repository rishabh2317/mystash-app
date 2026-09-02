import { hydrateSearchProducts } from '@/src/mappers/searchProductHydration';
import { searchBlended } from '@/src/services/searchApi';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  COLLECTION_RELATED_PRODUCTS_LIMIT,
  buildRelatedProductsQuery,
  collectionProductIdSet,
  pickRelatedProducts,
} from '@/src/ui/collectionRelatedProducts';

export {
  COLLECTION_RELATED_PRODUCTS_LIMIT,
  buildRelatedProductsQuery,
  collectionProductIdSet,
  pickRelatedProducts,
} from '@/src/ui/collectionRelatedProducts';

/** Related catalog products via Search (excludes items already in the Collection). */
export async function loadCollectionRelatedProducts(
  collection: CollectionDetailViewModel,
  opts?: { limit?: number },
): Promise<import('@/src/types/catalogProduct').CatalogProductViewModel[]> {
  const query = buildRelatedProductsQuery(collection);
  if (!query) return [];

  const limit = opts?.limit ?? COLLECTION_RELATED_PRODUCTS_LIMIT;
  const excludeIds = collectionProductIdSet(collection.products);

  try {
    const res = await searchBlended({
      q: query,
      presentation: 'typed',
      limit: Math.max(limit * 2, 12),
    });
    const productCards =
      res.lanes?.products ?? res.results.filter((row) => row.entityType === 'product');
    const hydrated = await hydrateSearchProducts(productCards);
    return pickRelatedProducts(hydrated, excludeIds, limit);
  } catch {
    return [];
  }
}
