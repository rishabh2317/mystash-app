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

  it('keeps M4 / 15-inch identity tokens when matching Official+Amazon titles', () => {
    const n = new ProductNormalizer().normalize({
      draftId: 'd',
      externalId: 'e',
      name: 'Apple MacBook Air 15 M4',
      brand: 'Apple',
      model: 'MacBook Air 15 M4',
      confidence: 0.98,
    });
    const scorer = new MatchScorer();
    const apple = scorer.score(n, {
      merchant: 'Apple',
      merchantUrl: 'https://www.apple.com/macbook-air/',
      title: 'Buy MacBook Air 15-inch Laptop with M4 chip - Apple',
      image: null,
      score: 0.9,
    });
    assert.ok(n.normalizedName.includes('m4'), 'canonical name must retain M4');
    assert.ok(apple.components.model >= 0.75, apple.reason);
    assert.ok(apple.components.title >= 0.8, apple.reason);
    assert.ok(apple.score > 0.7, apple.reason);
  });
});
