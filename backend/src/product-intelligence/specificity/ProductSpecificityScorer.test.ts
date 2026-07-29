import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import { scoreProductSpecificity } from './ProductSpecificityScorer';

const normalizer = new ProductNormalizer();

function assess(name: string, extra: Record<string, unknown> = {}) {
  const draft = {
    draftId: 'd',
    externalId: 'e',
    name,
    confidence: 0.99,
    ...extra,
  };
  return scoreProductSpecificity(draft, normalizer.normalize(draft), 0.55);
}

describe('ProductSpecificityScorer', () => {
  it('gates generic categories regardless of AI confidence', () => {
    for (const name of ['Shoes', 'Running Shoes', 'Jacket', 'Phone', 'Laptop', 'Headphones']) {
      assert.equal(assess(name).decision, 'review_only', name);
    }
  });

  it('accepts brand and model specific products', () => {
    assert.equal(assess('Nike Air Max 95', { brand: 'Nike', model: 'Air Max 95' }).decision, 'searchable');
    assert.equal(assess('Sony WH-1000XM6', { brand: 'Sony', model: 'WH-1000XM6' }).decision, 'searchable');
    assert.equal(assess('MacBook Air M4', { brand: 'Apple', model: 'M4' }).decision, 'searchable');
  });

  it('allows an explicit merchant PDP for manual products', () => {
    assert.equal(
      assess('Running Shoes', { merchantUrl: 'https://nike.com/products/air-max-95' }).decision,
      'searchable',
    );
  });
});
