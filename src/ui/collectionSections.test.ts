import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';

import {
  COLLECTION_MERCHANT_PREVIEW_LIMIT,
  collectionMerchantPreviewsFromOffers,
  collectionMerchantPreviewsFromProduct,
  collectionMetaItems,
  collectionVerificationSummary,
  formatCollectionDate,
  formatProductPrice,
  merchantLabelFromUrl,
  productCountLabel,
  productsSectionTitle,
  shouldGroupProductInsights,
  verificationSummaryLabel,
} from './collectionSections';

function product(overrides: Partial<CatalogProductViewModel> = {}): CatalogProductViewModel {
  return {
    id: 'p1',
    catalogProductId: 'cp1',
    title: 'Bose Ultra Open Earbuds',
    brand: 'Bose',
    merchant: 'bose.com',
    heroImage: null,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'VERIFIED',
    availability: null,
    price: '299.00',
    currency: 'USD',
    lastVerifiedAt: '2026-09-03T10:00:00.000Z',
    metadataCompleteness: null,
    ...overrides,
  };
}

function collection(
  overrides: Partial<CollectionDetailViewModel> = {},
): CollectionDetailViewModel {
  return {
    collectionId: 'c1',
    slug: 'bose-ultra-open-earbuds',
    title: 'Bose Ultra Open Earbuds',
    caption: null,
    heroThumbnailUrl: null,
    qualityScore: null,
    publishedAt: '2024-04-22T00:00:00.000Z',
    creator: { id: 'u1', username: 'rama', displayName: 'Rama', avatarUrl: null },
    counters: { views: 234, saves: 0 },
    primaryMedia: null,
    products: [product()],
    ...overrides,
  };
}

describe('productCountLabel / productsSectionTitle', () => {
  it('agrees with the product count', () => {
    assert.equal(productCountLabel(1), '1 Product');
    assert.equal(productCountLabel(3), '3 Products');
    assert.equal(productsSectionTitle(1), '1 Product in this collection');
    assert.equal(productsSectionTitle(4), '4 Products in this collection');
  });

  it('never renders a negative or fractional count', () => {
    assert.equal(productCountLabel(-2), '0 Products');
    assert.equal(productCountLabel(2.7), '2 Products');
  });
});

describe('formatCollectionDate', () => {
  it('formats an ISO timestamp', () => {
    const label = formatCollectionDate('2026-09-03T10:00:00.000Z');
    assert.ok(label);
    assert.match(label, /2026/);
  });

  it('returns null for missing or unparseable values', () => {
    assert.equal(formatCollectionDate(null), null);
    assert.equal(formatCollectionDate(undefined), null);
    assert.equal(formatCollectionDate('   '), null);
    assert.equal(formatCollectionDate('not-a-date'), null);
  });
});

describe('collectionMetaItems', () => {
  it('emits product count, views and publish date when the collection has them', () => {
    const items = collectionMetaItems(collection());
    assert.deepEqual(
      items.map((item) => item.id),
      ['products', 'views', 'created'],
    );
    assert.equal(items[0].label, '1 Product');
    assert.equal(items[1].label, '234 Views');
    assert.match(items[2].label, /^Created /);
  });

  it('omits views at zero and the date when the collection is unpublished', () => {
    const items = collectionMetaItems(
      collection({ counters: { views: 0, saves: 0 }, publishedAt: null }),
    );
    assert.deepEqual(
      items.map((item) => item.id),
      ['products'],
    );
  });

  it('singularises a single view', () => {
    const items = collectionMetaItems(collection({ counters: { views: 1, saves: 0 } }));
    assert.equal(items[1].label, '1 View');
  });
});

describe('shouldGroupProductInsights', () => {
  it('only groups AI Review under its own heading beyond one product', () => {
    assert.equal(shouldGroupProductInsights(0), false);
    assert.equal(shouldGroupProductInsights(1), false);
    assert.equal(shouldGroupProductInsights(2), true);
  });
});

describe('collectionVerificationSummary', () => {
  it('counts verified products and keeps the most recent verification', () => {
    const summary = collectionVerificationSummary([
      product({ id: 'a', lastVerifiedAt: '2026-01-01T00:00:00.000Z' }),
      product({ id: 'b', lastVerifiedAt: '2026-06-01T00:00:00.000Z' }),
      product({ id: 'c', verificationStatus: 'UNVERIFIED', lastVerifiedAt: null }),
    ]);
    assert.deepEqual(summary, {
      verified: 2,
      total: 3,
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('ignores unparseable timestamps', () => {
    const summary = collectionVerificationSummary([
      product({ id: 'a', lastVerifiedAt: 'whenever' }),
      product({ id: 'b', lastVerifiedAt: '   ' }),
    ]);
    assert.equal(summary.lastVerifiedAt, null);
  });

  it('handles an empty collection', () => {
    assert.deepEqual(collectionVerificationSummary([]), {
      verified: 0,
      total: 0,
      lastVerifiedAt: null,
    });
  });
});

describe('verificationSummaryLabel', () => {
  it('has nothing to say about an empty collection', () => {
    assert.equal(
      verificationSummaryLabel({ verified: 0, total: 0, lastVerifiedAt: null }),
      null,
    );
  });

  it('states matching facts and never an authenticity claim', () => {
    const all = [
      verificationSummaryLabel({ verified: 0, total: 2, lastVerifiedAt: null }),
      verificationSummaryLabel({ verified: 1, total: 1, lastVerifiedAt: null }),
      verificationSummaryLabel({ verified: 3, total: 3, lastVerifiedAt: null }),
      verificationSummaryLabel({ verified: 1, total: 3, lastVerifiedAt: null }),
    ];
    assert.deepEqual(all, [
      'Product details are still being verified.',
      'This product was matched to its merchant listing and verified.',
      'All 3 products were matched to their merchant listings and verified.',
      '1 of 3 products verified against merchant listings.',
    ]);
    for (const label of all) {
      assert.doesNotMatch(label ?? '', /authentic|warranty|genuine|guarantee/i);
    }
  });
});

describe('formatProductPrice', () => {
  it('prefixes the currency only when the catalog supplied one', () => {
    assert.equal(formatProductPrice(product()), 'USD 299.00');
    assert.equal(formatProductPrice(product({ currency: null })), '299.00');
    assert.equal(formatProductPrice(product({ currency: '  ' })), '299.00');
  });

  it('does not repeat a currency the price string already carries', () => {
    assert.equal(formatProductPrice(product({ price: 'USD 18,000.00' })), 'USD 18,000.00');
    assert.equal(formatProductPrice(product({ price: 'usd 18,000.00' })), 'usd 18,000.00');
    assert.equal(
      formatProductPrice(product({ currency: 'INR', price: '₹3,466.76' })),
      'INR ₹3,466.76',
    );
  });

  it('returns null when there is no real price to show', () => {
    assert.equal(formatProductPrice(product({ price: null })), null);
    assert.equal(formatProductPrice(product({ price: '  ' })), null);
    assert.equal(formatProductPrice(product({ price: '—' })), null);
  });
});

describe('collection merchant previews', () => {
  it('builds priced buying options from offers and product fallbacks', () => {
    assert.deepEqual(
      collectionMerchantPreviewsFromOffers([
        { id: 'o1', merchant: 'Amazon', price: '249.00', currency: 'USD' },
        { id: 'o2', merchant: 'Amazon', price: '249.00', currency: 'USD' },
        { id: 'o3', merchant: 'Flipkart', price: '229.00', currency: 'USD' },
        { id: 'o4', merchant: null, price: '219.00', currency: 'USD' },
        { id: 'o5', merchant: null, price: null },
        { id: 'o6', merchant: 'Gone', action: 'none', price: '1.00', currency: 'USD' },
      ]),
      [
        { id: 'o1', label: 'Amazon', priceLabel: 'USD 249.00' },
        { id: 'o3', label: 'Flipkart', priceLabel: 'USD 229.00' },
        { id: 'o4', label: 'Shop', priceLabel: 'USD 219.00' },
      ],
    );
    assert.deepEqual(collectionMerchantPreviewsFromProduct(product()), [
      { id: 'merchant-name', label: 'bose.com', priceLabel: 'USD 299.00' },
    ]);
    assert.equal(merchantLabelFromUrl('https://www.amazon.in/dp/x'), 'amazon.in');
    assert.equal(COLLECTION_MERCHANT_PREVIEW_LIMIT, 3);
  });
});
