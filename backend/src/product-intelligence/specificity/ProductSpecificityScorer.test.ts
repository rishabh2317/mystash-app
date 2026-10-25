import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import {
  isBrandBackedDistinctiveLine,
  scoreProductSpecificity,
} from './ProductSpecificityScorer';

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

  it('keeps the 0.55 score gate and adds a brand-backed line search signal', () => {
    const searchable = [
      ['Mind Shoes', 'Nike'],
      ['Nike Mind Shoes', 'Nike'],
      ['Bose SoundLink Max', 'Bose'],
      ['Dyson Airwrap', 'Dyson'],
      ['Sony WH-1000XM6', 'Sony'],
    ] as const;
    for (const [name, brand] of searchable) {
      const result = assess(name, { brand });
      assert.equal(isBrandBackedDistinctiveLine(normalizer.normalize({
        draftId: 'd',
        externalId: 'e',
        name,
        brand,
        confidence: 0.99,
      })), true, name);
      if (name === 'Sony WH-1000XM6') {
        assert.equal(result.decision, 'searchable', name);
      } else {
        assert.equal(result.decision, 'review_only', name);
        assert.ok(result.score < 0.55, name);
      }
    }

    const mind = assess('Nike Mind Shoes', { brand: 'Nike' });
    assert.equal(mind.score, 0.42);
    assert.deepEqual(mind.reasons, ['multi_token_name', 'brand_present']);

    for (const [name, brand] of [
      ['Nike Shoe', 'Nike'],
      ['Adidas Shoes', 'Adidas'],
      ['Samsung Phone', 'Samsung'],
      ['Sony Headphones', 'Sony'],
    ] as const) {
      const result = assess(name, { brand });
      assert.equal(result.decision, 'review_only', name);
      assert.equal(isBrandBackedDistinctiveLine(normalizer.normalize({
        draftId: 'd',
        externalId: 'e',
        name,
        brand,
        confidence: 0.99,
      })), false, name);
    }
  });
});
