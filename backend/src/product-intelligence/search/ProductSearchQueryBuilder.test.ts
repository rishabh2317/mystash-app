import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiDraftInput } from '../domain/types';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import { buildProductSearchQuery } from './ProductSearchQueryBuilder';

describe('ProductSearchQueryBuilder', () => {
  it('prioritizes brand/model and adds bounded multimodal context', () => {
    const draft: AiDraftInput = {
      draftId: 'd',
      externalId: 'e',
      name: 'Running Shoe',
      brand: 'Nike',
      model: 'Air Max 95',
      category: 'shoes',
      confidence: 0.9,
      evidence: {
        summary: 'Black shoe with Air Max branding visible near the heel',
        logoHits: ['Nike'],
        ocrMentions: true,
      },
      videoTitle: 'Best black running shoes for daily use',
    };
    const result = buildProductSearchQuery(draft, new ProductNormalizer().normalize(draft));
    assert.match(result.query, /Nike/i);
    assert.match(result.query, /Air Max 95/i);
    assert.ok(result.terms.length <= 9);
    assert.equal(result.query, buildProductSearchQuery(draft, new ProductNormalizer().normalize(draft)).query);
  });

  it('does not emit a bare category query', () => {
    const draft: AiDraftInput = {
      draftId: 'd',
      externalId: 'e',
      name: 'Sony WH-1000XM6',
      brand: 'Sony',
      model: 'WH-1000XM6',
      category: 'headphones',
      confidence: 0.9,
    };
    const result = buildProductSearchQuery(draft, new ProductNormalizer().normalize(draft));
    assert.notEqual(result.query, 'headphones');
    assert.match(result.query, /Sony WH-1000XM6/i);
  });

  it('removes noisy extraction words from the query', () => {
    const draft: AiDraftInput = {
      draftId: 'd',
      externalId: 'e',
      name: 'Adidas Messi Signature Boots titled Rating product',
      brand: 'Adidas',
      model: 'F50',
      category: 'boots',
      confidence: 0.9,
      videoTitle: 'Best official product review video',
    };
    const result = buildProductSearchQuery(draft, new ProductNormalizer().normalize(draft));

    assert.match(result.query, /Adidas/i);
    assert.match(result.query, /F50/i);
    assert.doesNotMatch(result.query, /\b(titled|rating|product|review|video|best|official)\b/i);
    assert.ok(result.terms.length <= 6);
  });
});
