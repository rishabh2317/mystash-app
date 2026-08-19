import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductNormalizer, toCanonicalSlug } from '../normalizer/ProductNormalizer';

describe('toCanonicalSlug', () => {
  it('slugifies product titles', () => {
    assert.equal(toCanonicalSlug(['Apple', 'MacBook Air M4']), 'apple-macbook-air-m4');
  });
});

describe('ProductNormalizer', () => {
  const n = new ProductNormalizer();

  it('normalizes casing and aliases', () => {
    const out = n.normalize({
      draftId: 'd1',
      externalId: 'e1',
      name: '  macbook   air  air  ',
      brand: 'apple',
      confidence: 0.9,
      category: 'Electronics',
    });
    assert.equal(out.brand, 'Apple');
    assert.match(out.name, /MacBook/i);
    assert.equal(out.normalizedName.includes('macbook'), true);
    assert.ok(out.canonicalSlugBase.includes('apple'));
  });

  it('dedupes repeated words', () => {
    const out = n.normalize({
      draftId: 'd1',
      externalId: 'e1',
      name: 'Road Bicycle Bicycle',
      confidence: 0.8,
    });
    assert.equal(out.normalizedName.split(' ').filter((w) => w === 'bicycle').length, 1);
  });

  it('removes content descriptors without dropping model or variant tokens', () => {
    const out = n.normalize({
      draftId: 'd1',
      externalId: 'e1',
      name: 'Samsung Galaxy Z Fold 8 Unboxing ASMR First Look',
      brand: 'Samsung',
      model: 'Galaxy Z Fold 8 Hands-on Review',
      confidence: 1,
    });

    assert.equal(out.name, 'Samsung Galaxy Z Fold 8');
    assert.equal(out.model, 'Galaxy Z Fold 8');
    assert.match(out.name, /\bZ Fold 8\b/);
  });
});
