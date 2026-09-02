import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';

export const COLLECTION_RELATED_PRODUCTS_LIMIT = 8;

export function collectionProductIdSet(products: CatalogProductViewModel[]): Set<string> {
  const ids = new Set<string>();
  for (const p of products) {
    const id = (p.catalogProductId ?? p.id).trim();
    if (id) ids.add(id);
  }
  return ids;
}

/** Build a search query from collection context without inventing products. */
export function buildRelatedProductsQuery(collection: CollectionDetailViewModel): string | null {
  const primary = collection.products[0];
  const brand = primary?.brand?.trim();
  const title = primary?.title?.trim();
  if (brand && title) return `${brand} ${title}`;
  if (title) return title;
  const collectionTitle = collection.title?.trim();
  if (collectionTitle) return collectionTitle;
  return null;
}

export function pickRelatedProducts(
  candidates: CatalogProductViewModel[],
  excludeIds: Set<string>,
  limit = COLLECTION_RELATED_PRODUCTS_LIMIT,
): CatalogProductViewModel[] {
  const out: CatalogProductViewModel[] = [];
  for (const product of candidates) {
    const id = (product.catalogProductId ?? product.id).trim();
    if (!id || excludeIds.has(id)) continue;
    out.push(product);
    if (out.length >= limit) break;
  }
  return out;
}
