import type { CartLine } from '@/src/services/cartLineMap';
import type { FindSourceResult } from '@/src/services/findClient';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import type { PlaceStashItem } from '@/src/types/placeStash';
import { findIdentityProductId } from './find';

export type SourceProduct = Extract<FindSourceResult, { kind: 'product' }>;
export type SourcePlace = Extract<FindSourceResult, { kind: 'place' }>;
export type SourceGridRow = { kind: 'heading'; key: string; label: string; count: number | null }
  | { kind: 'products'; key: string; items: SourceProduct[] }
  | { kind: 'places'; key: string; items: SourcePlace[] };

export function sourceResultKey(row: FindSourceResult): string {
  return row.kind === 'product' ? `product:${row.result.identityKey ?? ('id' in row.result ? row.result.id : row.result.sourceProductId)}`
    : `place:${row.result.placeId ?? row.result.id}`;
}

/** A page boundary can move after a save/removal; retain each canonical item once. */
export function mergeSourceResults(existing: FindSourceResult[], incoming: FindSourceResult[]): FindSourceResult[] {
  const rows = new Map(existing.map(row => [sourceResultKey(row), row]));
  incoming.forEach(row => rows.set(sourceResultKey(row), row));
  return [...rows.values()];
}

/** The mixed cursor remains intact; only presentation groups saved rows by kind. */
export function groupSourceRows(items: FindSourceResult[], columns: 1 | 2, productCount: number | null, placeCount: number | null): SourceGridRow[] {
  const products = items.filter((row): row is SourceProduct => row.kind === 'product');
  const places = items.filter((row): row is SourcePlace => row.kind === 'place');
  const rows: SourceGridRow[] = [];
  if (products.length || (productCount ?? 0) > 0) {
    rows.push({ kind: 'heading', key: 'products-title', label: 'Products', count: productCount });
    for (let i = 0; i < products.length; i += columns)
      rows.push({ kind: 'products', key: `products:${i}`, items: products.slice(i, i + columns) });
  }
  if (places.length || (placeCount ?? 0) > 0) {
    rows.push({ kind: 'heading', key: 'places-title', label: 'Places', count: placeCount });
    for (let i = 0; i < places.length; i += columns)
      rows.push({ kind: 'places', key: `places:${i}`, items: places.slice(i, i + columns) });
  }
  return rows;
}

export function sourceProductId(row: SourceProduct): string | null {
  return ('catalogProductId' in row.result ? row.result.catalogProductId ?? row.result.discoveredProductId : null)
    ?? findIdentityProductId(row.result.identityKey ?? '');
}

/** Cart already carries Stash's full catalog projection; extracted data remains the fallback. */
export function sourceProductModel(row: SourceProduct, cartItems: CartLine[]): CatalogProductViewModel | null {
  const id = sourceProductId(row);
  if (!id) return null;
  const saved = cartItems.find(item => item.productId === id);
  if (saved?.product) return saved.product;
  return {
    id, catalogProductId: 'catalogProductId' in row.result ? row.result.catalogProductId : row.result.identityKey?.startsWith('c:') ? id : null,
    title: row.result.title, brand: null, merchant: null,
    heroImage: row.result.imageUrl ?? CATALOG_IMAGE_PLACEHOLDER, galleryImages: [],
    description: null, shortDescription: null, specifications: {}, verificationStatus: 'UNRESOLVED',
    availability: null, price: null, currency: null, lastVerifiedAt: null,
    metadataCompleteness: null, category: null,
  };
}

/** Use the saved-place projection where available, including its image and destination. */
export function sourcePlaceModel(row: SourcePlace, importId: string, places: PlaceStashItem[]): PlaceStashItem {
  const result = row.result;
  const saved = places.find(place => place.sources?.some(source => source.userImportId === importId && source.contentSourcePlaceId === result.id))
    ?? places.find(place => place.id === (result.placeId ?? result.id));
  if (saved) return saved;
  const location = [result.locality, result.city].filter(Boolean).join(', ');
  const query = [result.name, location].filter(Boolean).join(', ');
  return { kind: 'unresolved', id: result.id, name: result.name, category: null,
    locationContext: location || null, uncertainty: 'unconfirmed', image: null,
    destination: { kind: 'google_search', query, url: `https://www.google.com/search?q=${encodeURIComponent(query)}` } };
}
