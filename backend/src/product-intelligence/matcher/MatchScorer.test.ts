import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MatchScorer } from './MatchScorer';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';

describe('MatchScorer', () => {
  it('scores overlapping titles higher', () => {
    const n = new ProductNormalizer().normalize({
      draftId: 'd',
      externalId: 'e',
      name: 'Road Bicycle',
      confidence: 0.9,
    });
    const scorer = new MatchScorer();
    const good = scorer.score(n, {
      merchant: 'shop',
      merchantUrl: 'https://shop.example/bike',
      title: 'Road Bicycle Carbon Frame',
      image: null,
      score: 0.8,
    });
    const bad = scorer.score(n, {
      merchant: 'shop',
      merchantUrl: 'https://shop.example/mug',
      title: 'Coffee Mug Set',
      image: null,
      score: 0.8,
    });
    assert.ok(good.score > bad.score);
  });
});
