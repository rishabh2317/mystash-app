import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  FEED_SHOP_COPY,
  feedShopPresentation,
  shoppableProductOffers,
} from './feedShop';

const ROOT = join(import.meta.dirname, '..', '..');

describe('feedShop helpers', () => {
  it('classifies single vs multi merchant presentation', () => {
    assert.equal(feedShopPresentation(0), 'fallback');
    assert.equal(feedShopPresentation(1), 'direct');
    assert.equal(feedShopPresentation(2), 'sheet');
    assert.deepEqual(
      shoppableProductOffers([
        { id: 'a', merchant: 'A', price: '1', currency: 'USD', availability: null, action: 'buy' },
        { id: 'b', merchant: 'B', price: '2', currency: 'USD', availability: null, action: 'none' },
        { id: 'c', merchant: 'C', price: '3', currency: 'USD', availability: null, action: 'listing' },
      ]).map((o) => o.id),
      ['a', 'c'],
    );
    assert.equal(FEED_SHOP_COPY.shopThisPost, 'Shop this post');
  });
});

describe('Home feed product zone contracts', () => {
  it('shelf uses Shop this post CTA + mini ProductCard rail', () => {
    const shelf = readFileSync(join(ROOT, 'components/feed/FeedProductShelf.tsx'), 'utf8');
    const card = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const sheet = readFileSync(join(ROOT, 'components/feed/FeedProductSheet.tsx'), 'utf8');
    const home = readFileSync(join(ROOT, 'app/(tabs)/index.tsx'), 'utf8');

    assert.match(shelf, /FEED_SHOP_COPY\.shopThisPost/);
    assert.match(shelf, /chevron-forward/);
    assert.match(shelf, /collectionPath/);
    assert.match(shelf, /shopPill/);
    assert.match(shelf, /variant="mini"/);
    assert.doesNotMatch(shelf, /HERO_WIDTH|CHIP_SIZE|selected\.price/);
    assert.match(card, /variant === 'mini'/);
    assert.match(card, /outlineCardChrome/);
    assert.match(sheet, /fetchProductPage/);
    assert.match(sheet, /fetchLivePrices/);
    assert.match(sheet, /openProductShopping/);
    assert.match(sheet, /feedShopPresentation/);
    assert.match(sheet, /shoppableProductOffers/);
    assert.doesNotMatch(sheet, /ProductDetailsSheet/);
    assert.match(home, /FeedProductSheet/);
  });
});
