import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { catalogProductInBag } from './bagMembership';

describe('catalogProductInBag', () => {
  it('is true only for a matching catalog id already in Bag', () => {
    const items = [{ catalogProductId: 'cat-1' }, { catalogProductId: 'cat-2' }];
    assert.equal(catalogProductInBag(items, 'cat-1'), true);
    assert.equal(catalogProductInBag(items, 'cat-9'), false);
    assert.equal(catalogProductInBag(items, null), false);
    assert.equal(catalogProductInBag(items, '  '), false);
  });
});
