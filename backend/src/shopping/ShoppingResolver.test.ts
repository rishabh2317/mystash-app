import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import { AffiliateService } from './AffiliateService';
import { ShoppingResolver } from './ShoppingResolver';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'product-1',
    canonicalSlug: 'product-1',
    brand: null,
    name: 'Product',
    normalizedName: 'product',
    model: null,
    category: null,
    description: null,
    imageUrl: null,
    merchant: 'Official Store',
    merchantUrl: 'https://merchant.example/products/1',
    preferredShoppingUrl: 'https://shop.example/products/1',
    affiliateUrl: 'https://mystash.go.link/?d=legacy',
    shoppingProvider: 'merchant',
    currency: null,
    price: null,
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    verificationProvider: 'serper',
    verificationSource: 'serper',
    verificationVersion: 'v1',
    lastVerifiedAt: null,
    aiConfidence: null,
    matchConfidence: null,
    verificationConfidence: null,
    mergedIntoId: null,
    metadata: {},
    ...overrides,
  };
}

describe('ShoppingResolver', () => {
  it('ignores legacy affiliate URLs while affiliate support is disabled', () => {
    const resolver = new ShoppingResolver(
      new AffiliateService({ enabled: false, provider: 'none' }),
    );

    const result = resolver.resolve(product());

    assert.equal(result?.url, 'https://shop.example/products/1');
    assert.equal(result?.destinationType, 'preferred');
    assert.equal(result?.affiliateProvider, null);
  });

  it('falls back from preferred shopping URL to the canonical merchant URL', () => {
    const resolver = new ShoppingResolver(
      new AffiliateService({ enabled: false, provider: 'none' }),
    );

    const result = resolver.resolve(product({ preferredShoppingUrl: 'javascript:alert(1)' }));

    assert.equal(result?.url, 'https://merchant.example/products/1');
    assert.equal(result?.destinationType, 'merchant');
  });

  it('returns no destination when every URL is missing or unsafe', () => {
    const resolver = new ShoppingResolver(
      new AffiliateService({ enabled: false, provider: 'none' }),
    );

    const result = resolver.resolve(
      product({ preferredShoppingUrl: null, merchantUrl: 'file:///tmp/product', affiliateUrl: null }),
    );

    assert.equal(result, null);
  });
});
