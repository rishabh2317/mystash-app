import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRelatedProductsQuery,
  collectionProductIdSet,
  pickRelatedProducts,
} from '@/src/ui/collectionRelatedProducts';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';

function product(id: string, brand?: string | null): CatalogProductViewModel {
  return {
    id,
    catalogProductId: id,
    title: `Title ${id}`,
    brand: brand ?? null,
    merchant: null,
    heroImage: null,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'VERIFIED',
    availability: null,
    price: null,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  };
}

function collection(partial: Partial<CollectionDetailViewModel> = {}): CollectionDetailViewModel {
  return {
    collectionId: 'col-1',
    slug: 'slug',
    title: 'Summer picks',
    caption: null,
    heroThumbnailUrl: null,
    qualityScore: null,
    publishedAt: null,
    creator: {
      id: 'creator-1',
      username: 'alex',
      displayName: 'Alex',
      avatarUrl: null,
    },
    counters: { views: 0, saves: 0 },
    primaryMedia: null,
    products: [product('p1', 'Nike')],
    ...partial,
  };
}

describe('collectionRelatedProducts', () => {
  it('builds related search query from primary product brand and title', () => {
    assert.equal(buildRelatedProductsQuery(collection()), 'Nike Title p1');
    assert.equal(
      buildRelatedProductsQuery(collection({ products: [product('p1', null)] })),
      'Title p1',
    );
    assert.equal(
      buildRelatedProductsQuery(collection({ products: [], title: 'Desk setup' })),
      'Desk setup',
    );
  });

  it('excludes collection products and caps related results', () => {
    const exclude = collectionProductIdSet([product('p1'), product('p2')]);
    const picked = pickRelatedProducts(
      [product('p1'), product('p3'), product('p4'), product('p5')],
      exclude,
      2,
    );
    assert.deepEqual(picked.map((p) => p.id), ['p3', 'p4']);
  });
});
