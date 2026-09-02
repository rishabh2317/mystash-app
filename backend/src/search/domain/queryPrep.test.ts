import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractQueryConstraints } from './queryPrep';

describe('extractQueryConstraints', () => {
  it('parses under budget and strips phrase from search text', () => {
    const c = extractQueryConstraints('best headphones under 15000');
    assert.equal(c.priceMax, 15000);
    assert.equal(c.searchText, 'best headphones');
  });

  it('parses k suffix', () => {
    const c = extractQueryConstraints('laptop under 15k');
    assert.equal(c.priceMax, 15000);
    assert.equal(c.searchText, 'laptop');
  });

  it('parses over minimum', () => {
    const c = extractQueryConstraints('shoes over 2000');
    assert.equal(c.priceMin, 2000);
    assert.equal(c.searchText, 'shoes');
  });

  it('returns original text when no constraints', () => {
    const c = extractQueryConstraints('nike running shoes');
    assert.equal(c.searchText, 'nike running shoes');
    assert.equal(c.priceMax, undefined);
    assert.equal(c.priceMin, undefined);
  });
});
