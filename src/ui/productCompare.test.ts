import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { ProductPageView } from '@/src/types/productPage';
import {
  COMPARE_COPY,
  COMPARE_MAX,
  buildProductComparison,
  canAddCompareId,
  compareHeaderPrice,
  comparePath,
  comparePriceLines,
  compareReviewSummary,
  hasComparableFacts,
  parseCompareIds,
} from '@/src/ui/productCompare';

const ROOT = process.cwd();
const FORBIDDEN = /discovered product|unverified|confidence|completeness|catalogue status|catalog status|ai status|verification/i;
const WINNER = /\b(winner|best|recommended|recommendation|score|ranking)\b/i;

function page(partial: Partial<ProductPageView> & Pick<ProductPageView, 'productId' | 'title'>): ProductPageView {
  return {
    shoppingProductId: partial.shoppingProductId ?? partial.productId,
    brand: null,
    category: null,
    heroImage: null,
    galleryImages: [],
    price: null,
    currency: null,
    merchant: null,
    description: null,
    specifications: {},
    offers: [],
    canShop: false,
    source: null,
    relatedMedia: [],
    reviews: null,
    compareAvailable: true,
    detailsUpdating: false,
    ...partial,
  };
}

describe('product comparison', () => {
  it('parses 2–4 ids and builds a compare path', () => {
    assert.deepEqual(parseCompareIds('a,b,a,c'), ['a', 'b', 'c']);
    assert.deepEqual(parseCompareIds(['a', 'b,c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd']);
    assert.equal(comparePath(['xm5', 'xm6']), '/compare?ids=xm5,xm6');
    assert.equal(canAddCompareId(['a', 'b'], 'c'), true);
    assert.equal(canAddCompareId(['a', 'b', 'c', 'd'], 'e'), false);
    assert.equal(canAddCompareId(['a'], 'a'), false);
    assert.equal(COMPARE_MAX, 4);
  });

  it('compares two canonical products without inventing missing specs', () => {
    const comparison = buildProductComparison([
      page({
        productId: 'xm5',
        title: 'WH-1000XM5',
        brand: 'Sony',
        category: 'Headphones',
        price: '299.00',
        currency: 'USD',
        merchant: 'Sony Store',
        specifications: { Battery: '30h', ANC: 'Yes', Weight: '250g', Driver: '30mm' },
        offers: [{ id: 'o1', merchant: 'Sony Store', price: '299.00', currency: 'USD', availability: 'In stock', action: 'buy' }],
        reviews: {
          overview: 'Comfortable everyday headphones.',
          likes: ['Comfortable for long sessions'],
          concerns: ['Weaker isolation'],
          sources: [],
          rating: null,
          reviewCount: null,
        },
      }),
      page({
        productId: 'xm6',
        title: 'WH-1000XM6',
        brand: 'Sony',
        category: 'Headphones',
        price: '399.00',
        currency: 'USD',
        merchant: 'Sony Store',
        specifications: { 'Battery life': '40h', Weight: '254g', Codec: 'LDAC' },
        offers: [{ id: 'o2', merchant: 'Sony Store', price: '399.00', currency: 'USD', availability: null, action: 'buy' }],
      }),
    ]);

    assert.equal(comparison.products.length, 2);
    assert.equal(comparison.products[0]?.productPath, '/product/xm5');
    assert.equal(comparison.products[1]?.productPath, '/product/xm6');

    const byId = Object.fromEntries(comparison.rows.map((row) => [row.id, row]));
    assert.equal(byId.price?.values[0], 'Sony Store · USD 299.00');
    assert.equal(byId.price?.values[1], 'Sony Store · USD 399.00');
    assert.equal(byId.battery?.values[0], '30h');
    assert.equal(byId.battery?.values[1], '40h');
    assert.equal(byId.anc?.values[0], 'Yes');
    assert.equal(byId.anc?.values[1], null);
    assert.equal(byId.weight?.values[0], '250g');
    assert.equal(byId.codec?.values[1], 'LDAC');
    assert.equal(byId.reviews?.values[0], 'Comfortable everyday headphones.');
    assert.equal(byId.reviews?.values[1], null);
    assert.equal(byId.rating, undefined);
  });

  it('compares more than two products and keeps leftover spec keys', () => {
    const comparison = buildProductComparison([
      page({
        productId: 'air',
        title: 'MacBook Air',
        category: 'Laptops',
        specifications: { Chip: 'M3', RAM: '16GB', Storage: '512GB', Display: '13.6"', Color: 'Midnight' },
        offers: [{ id: 'a', merchant: 'Apple', price: '1299', currency: 'USD', availability: null, action: 'buy' }],
      }),
      page({
        productId: 'pro',
        title: 'MacBook Pro',
        category: 'Laptops',
        specifications: { Chip: 'M4', RAM: '24GB', Storage: '1TB', Weight: '1.6kg' },
        offers: [{ id: 'b', merchant: 'Apple', price: '1999', currency: 'USD', availability: null, action: 'buy' }],
      }),
      page({
        productId: 'xps',
        title: 'XPS 14',
        category: 'Laptops',
        specifications: { Processor: 'Ultra 7', RAM: '32GB', Storage: '1TB', Frame: 'Carbon' },
        offers: [{ id: 'c', merchant: 'Dell', price: '1899', currency: 'USD', availability: null, action: 'buy' }],
      }),
    ]);
    assert.equal(comparison.products.length, 3);
    const byId = Object.fromEntries(comparison.rows.map((row) => [row.id, row]));
    assert.deepEqual(byId.processor?.values, ['M3', 'M4', 'Ultra 7']);
    assert.deepEqual(byId.ram?.values, ['16GB', '24GB', '32GB']);
    assert.equal(byId.color?.values[0], 'Midnight');
    assert.equal(byId.color?.values[1], null);
    assert.equal(byId['spec:Frame']?.values[2], 'Carbon');
    assert.equal(byId['spec:Frame']?.values[0], null);
  });

  it('lets a share-imported product sit next to a catalogue product using only stored facts', () => {
    const imported = page({
      productId: 'disc-1',
      shoppingProductId: null,
      title: 'Ceramic mug',
      price: '12',
      currency: 'USD',
      merchant: 'Acme',
      specifications: { Color: 'White', Size: '12oz' },
      offers: [{ id: 'd', merchant: 'Acme', price: '12', currency: 'USD', availability: null, action: 'listing' }],
    });
    const catalog = page({
      productId: 'cat-1',
      title: 'Travel mug',
      category: 'Home',
      specifications: { Color: 'Black', Lid: 'Yes' },
      offers: [{ id: 'c', merchant: 'Store', price: '24', currency: 'USD', availability: null, action: 'buy' }],
    });
    assert.equal(hasComparableFacts(imported), true);
    const comparison = buildProductComparison([imported, catalog]);
    const byId = Object.fromEntries(comparison.rows.map((row) => [row.id, row]));
    assert.equal(byId.color?.values[0], 'White');
    assert.equal(byId.color?.values[1], 'Black');
    assert.equal(byId.size?.values[0], '12oz');
    assert.equal(byId.size?.values[1], null);
    assert.equal(byId['spec:Lid']?.values[1], 'Yes');
    assert.equal(comparison.products[0]?.productId, 'disc-1');
  });

  it('shows phones, consoles and missing prices without filling them in', () => {
    const phone = page({
      productId: 'pixel',
      title: 'Pixel 9',
      category: 'Phones',
      specifications: { Display: '6.3"', Processor: 'Tensor', Camera: '50MP', Battery: '4700mAh', Charging: '27W', Storage: '256GB' },
    });
    const console = page({
      productId: 'ps5',
      title: 'PlayStation 5',
      category: 'Gaming consoles',
      specifications: { Storage: '1TB', Resolution: '4K', Platform: 'PS5', Controller: 'DualSense included' },
      offers: [
        { id: 's1', merchant: 'Sony', price: '499', currency: 'USD', availability: null, action: 'buy' },
        { id: 's2', merchant: 'Best Buy', price: '479', currency: 'USD', availability: null, action: 'buy' },
      ],
    });
    assert.equal(hasComparableFacts(phone), true);
    assert.equal(comparePriceLines(phone), null);
    assert.equal(compareHeaderPrice(console), null);
    assert.equal(comparePriceLines(console), 'Sony · USD 499\nBest Buy · USD 479');

    const mixed = buildProductComparison([phone, console]);
    const byId = Object.fromEntries(mixed.rows.map((row) => [row.id, row]));
    assert.equal(byId.price?.values[0], null);
    assert.equal(byId.storage?.values[0], '256GB');
    assert.equal(byId.storage?.values[1], '1TB');
    assert.equal(byId.camera?.values[1], null);
    assert.equal(byId.controller?.values[0], null);
    assert.equal(byId.controller?.values[1], 'DualSense included');
  });

  it('does not invent a review summary or a rating', () => {
    assert.equal(compareReviewSummary(null), null);
    assert.equal(
      compareReviewSummary({
        overview: null,
        likes: ['Quiet cabin'],
        concerns: [],
        sources: [],
        rating: null,
        reviewCount: null,
      }),
      null,
    );
    assert.equal(
      compareReviewSummary({
        overview: 'Clear calls.',
        likes: [],
        concerns: [],
        sources: [],
        rating: '4.6',
        reviewCount: 120,
      }),
      '4.6 · 120 reviews\nClear calls.',
    );
    assert.equal(
      hasComparableFacts(page({ productId: 'empty', title: 'Unknown item' })),
      false,
    );
  });

  it('never uses winner language or internals in compare copy', () => {
    for (const value of Object.values(COMPARE_COPY)) {
      assert.doesNotMatch(value, FORBIDDEN);
      assert.doesNotMatch(value, WINNER);
    }
    const logic = readFileSync(join(ROOT, 'src/ui/productCompare.ts'), 'utf8');
    assert.doesNotMatch(logic, WINNER);
    assert.doesNotMatch(logic, /catalog_products|promote/);
  });

  it('Product Page opens Compare and Search navigates to Product Page', () => {
    const screen = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    const compare = readFileSync(join(ROOT, 'app/compare.tsx'), 'utf8');
    const search = readFileSync(join(ROOT, 'app/(tabs)/search.tsx'), 'utf8');
    const collection = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    const creator = readFileSync(join(ROOT, 'app/creator/[username].tsx'), 'utf8');
    assert.match(screen, /comparePath\(\[page\.productId\]\)/);
    assert.doesNotMatch(screen, /compareHint\)/);
    assert.match(compare, /fetchProductPage/);
    assert.match(compare, /searchBlended/);
    assert.match(compare, /COMPARE_COPY/);
    assert.doesNotMatch(compare, WINNER);
    assert.match(search, /productPagePath/);
    assert.doesNotMatch(search, /ProductDetailsSheet/);
    assert.doesNotMatch(search, /comparePath/);
    assert.match(collection, /productPagePath/);
    assert.doesNotMatch(collection, /ProductDetailsSheet/);
    assert.doesNotMatch(collection, /comparePath/);
    assert.match(creator, /productPagePath/);
    assert.doesNotMatch(creator, /ProductDetailsSheet/);
  });
});
