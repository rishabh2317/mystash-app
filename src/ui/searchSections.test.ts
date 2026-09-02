import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  popularFallbackMessage,
  searchSectionOrder,
  searchSectionTitle,
} from './searchSections';

describe('searchSections', () => {
  it('orders products first for commerce intent', () => {
    assert.deepEqual(searchSectionOrder('COMMERCE'), ['products', 'collections', 'creators']);
  });

  it('orders creators first for creator intent', () => {
    assert.deepEqual(searchSectionOrder('CREATOR'), ['creators', 'collections', 'products']);
  });

  it('defaults to collections first for discovery', () => {
    assert.deepEqual(searchSectionOrder('DISCOVERY'), ['collections', 'creators', 'products']);
  });

  it('labels commerce product section', () => {
    assert.equal(searchSectionTitle('products', 'COMMERCE'), 'Products to buy');
  });

  it('surfaces popular fallback copy', () => {
    assert.equal(
      popularFallbackMessage(['popular_suggestions']),
      'No exact matches — showing popular collections',
    );
    assert.equal(popularFallbackMessage(undefined), null);
  });
});
