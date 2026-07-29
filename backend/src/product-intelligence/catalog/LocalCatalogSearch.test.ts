import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fuzzyScore } from '../catalog/LocalCatalogSearch';
import { sortPreferVerified } from '../catalog/SupabaseCatalogRepository';
import type { CatalogProduct } from '../domain/types';

function stub(partial: Partial<CatalogProduct> & { id: string; name: string }): CatalogProduct {
  return {
    canonicalSlug: partial.id,
    brand: null,
    normalizedName: partial.name.toLowerCase(),
    model: null,
    category: null,
    description: null,
    imageUrl: null,
    merchant: null,
    merchantUrl: null,
    affiliateUrl: null,
    currency: null,
    price: null,
    status: 'ACTIVE',
    verificationStatus: 'UNVERIFIED',
    verificationSource: null,
    verificationVersion: null,
    lastVerifiedAt: null,
    aiConfidence: null,
    matchConfidence: null,
    verificationConfidence: null,
    mergedIntoId: null,
    metadata: {},
    ...partial,
    preferredShoppingUrl: partial.preferredShoppingUrl ?? null,
    shoppingProvider: partial.shoppingProvider ?? null,
    verificationProvider: partial.verificationProvider ?? partial.verificationSource ?? null,
  };
}

describe('fuzzyScore', () => {
  it('scores overlapping tokens', () => {
    assert.ok(fuzzyScore('road bicycle', 'road bike bicycle') > 0.5);
  });
});

describe('sortPreferVerified', () => {
  it('orders verified first', () => {
    const out = sortPreferVerified([
      stub({ id: 'u', name: 'Bike', verificationStatus: 'UNVERIFIED' }),
      stub({ id: 'v', name: 'Bike', verificationStatus: 'VERIFIED' }),
    ]);
    assert.equal(out[0]!.id, 'v');
  });
});
