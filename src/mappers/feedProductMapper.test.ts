import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CATALOG_IMAGE_PLACEHOLDER } from '../types/catalogProduct';
import { isFeedProductShopable, mapFeedProductToCatalogViewModel } from './feedProductMapper';

describe('feedProductMapper', () => {
  it('maps a linked catalog product as shoppable without picking a merchant URL', () => {
    const vm = mapFeedProductToCatalogViewModel({
      id: 'vp-1',
      name: 'Air Max',
      price: '$120',
      image: 'https://cdn.example/airmax.jpg',
      provider: 'Nike',
      catalog_product_id: 'cat-9',
    });
    assert.equal(vm.catalogProductId, 'cat-9');
    assert.equal(vm.title, 'Air Max');
    assert.equal(isFeedProductShopable({
      id: 'vp-1',
      name: 'Air Max',
      price: '$120',
      image: 'https://cdn.example/airmax.jpg',
      catalog_product_id: 'cat-9',
    }), true);
  });

  it('keeps unlinked products inspectable but not shoppable', () => {
    const vm = mapFeedProductToCatalogViewModel({
      id: 'vp-2',
      name: 'Unknown item',
      price: '—',
      image: 'not-a-url',
    });
    assert.equal(vm.catalogProductId, null);
    assert.equal(vm.verificationStatus, 'UNRESOLVED');
    assert.equal(vm.heroImage, CATALOG_IMAGE_PLACEHOLDER);
    assert.equal(vm.price, null);
    assert.equal(vm.availability, 'Shopping is not available yet');
    assert.equal(
      isFeedProductShopable({ id: 'vp-2', name: 'Unknown item', price: '—', image: '' }),
      false,
    );
  });
});
