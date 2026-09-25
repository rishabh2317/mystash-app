import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeMystashCategory,
  resolvePersistableCategory,
} from './categoryTaxonomy';

describe('categoryTaxonomy', () => {
  it('maps common extraction labels onto the Mystash allowlist', () => {
    assert.equal(normalizeMystashCategory('Headphones'), 'electronics');
    assert.equal(normalizeMystashCategory('smartphones'), 'electronics');
    assert.equal(normalizeMystashCategory('Gaming Consoles'), 'gaming');
    assert.equal(normalizeMystashCategory('sneakers'), 'fashion');
    assert.equal(normalizeMystashCategory('electronics'), 'electronics');
  });

  it('returns null for genuinely missing or non-defensible categories', () => {
    assert.equal(normalizeMystashCategory(null), null);
    assert.equal(normalizeMystashCategory(''), null);
    assert.equal(normalizeMystashCategory('unknown'), null);
    assert.equal(normalizeMystashCategory('misc widgetry'), null);
  });

  it('picks the first defensible category among candidates', () => {
    assert.equal(resolvePersistableCategory(null, 'unknown', 'laptops'), 'electronics');
    assert.equal(resolvePersistableCategory('phones', 'beauty'), 'electronics');
    assert.equal(resolvePersistableCategory(null, 'unknown'), null);
  });
});
