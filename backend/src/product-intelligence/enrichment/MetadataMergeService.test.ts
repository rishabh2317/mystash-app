import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchCandidate } from '../domain/types';
import { mergeEnrichedCandidates, validPriceValue } from './MetadataMergeService';

function candidate(partial: Partial<SearchCandidate> & { merchantUrl: string }): SearchCandidate {
  return {
    merchant: 'Store',
    title: 'Product',
    image: null,
    score: 0.9,
    brand: null,
    description: null,
    price: null,
    currency: null,
    enrichmentSucceeded: true,
    sourceTier: 'retailer',
    pdpVerdict: 'pdp',
    enrichmentMeta: {},
    ...partial,
  };
}

describe('MetadataMergeService', () => {
  it('merges fields independently across trusted merchants', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://www.apple.com/macbook',
        title: 'MacBook Air',
        brand: 'Apple',
        description: 'Official description',
        image: 'https://store.apple.com/hero.jpg',
        sourceTier: 'official',
        enrichmentMeta: {
          specifications: { Chip: 'M4' },
          short_description: 'Official short',
        },
      }),
      candidate({
        merchantUrl: 'https://www.amazon.in/dp/mac',
        title: 'Apple MacBook Air M4',
        brand: 'Apple',
        price: '99900',
        currency: 'INR',
        image: 'https://m.media-amazon.com/images/I/800x800.jpg',
        sourceTier: 'marketplace',
        enrichmentMeta: {
          specifications: { Chip: 'M4', Display: '13.6' },
          availability: 'InStock',
          price_last_verified_at: '2026-07-29T10:00:00.000Z',
        },
      }),
    ]);

    assert.equal(merged.title, 'MacBook Air');
    assert.equal(merged.metadataSourceMap.title?.source, 'apple.com');
    assert.equal(merged.price, '99900');
    assert.equal(merged.metadataSourceMap.price?.source, 'amazon.in');
    assert.equal(merged.heroImage, 'https://store.apple.com/hero.jpg');
    assert.deepEqual(merged.metadataSources.sort(), ['amazon.in', 'apple.com']);
    assert.ok(Object.keys(merged.specifications).length >= 1);
    assert.ok((merged.metadataSourceMap.title?.confidence ?? 0) > 0.9);
  });

  it('uses field authority before specification count', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://shop.example/p/1',
        sourceTier: 'retailer',
        enrichmentMeta: { specifications: { Color: 'Black' } },
      }),
      candidate({
        merchantUrl: 'https://www.bestbuy.com/site/p',
        sourceTier: 'marketplace',
        enrichmentMeta: {
          specifications: { Color: 'Black', Size: '10', Weight: '1lb' },
        },
      }),
    ]);
    assert.equal(Object.keys(merged.specifications).length, 1);
    assert.equal(merged.metadataSourceMap.specifications?.source, 'shop.example');
  });

  it('keeps an official title over a longer editorial headline', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://www.adidas.com/us/f50-elite-firm-ground-cleats/ABC.html',
        title: 'F50 Elite Firm Ground Cleats',
        sourceTier: 'official',
        candidatePageType: 'official_product',
      }),
      candidate({
        merchantUrl: 'https://football.example/messi-boots-review',
        title: 'Messi Boots 2026 What Does Messi Wear Adidas F50 Complete Review',
        sourceTier: 'editorial',
        candidatePageType: 'review_site',
        description: 'A very long editorial description with extensive product context and analysis.',
      }),
    ]);

    assert.equal(merged.title, 'F50 Elite Firm Ground Cleats');
    assert.equal(merged.metadataSourceMap.title?.source, 'adidas.com');
  });

  it('rejects duration and article text masquerading as prices', () => {
    assert.equal(validPriceValue('3 minutes', null), null);
    assert.equal(validPriceValue('Read More', null), null);
    assert.equal(validPriceValue('In Stock Soon', null), null);
    assert.equal(validPriceValue('₹0', null), null);
    assert.equal(validPriceValue('Free', null), null);
    assert.equal(validPriceValue('Unknown', null), null);
    assert.equal(validPriceValue('295', null), null);
    assert.equal(validPriceValue('295', 'UNKNOWN'), null);
    assert.equal(validPriceValue('$295', null), '$295');
    assert.equal(validPriceValue('₹27,999', null), '₹27,999');
    assert.equal(validPriceValue('USD 300', null), 'USD 300');
    assert.equal(validPriceValue('250', 'GBP'), '250');

    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://theruntesters.com/nike-alphafly-3-review',
        price: '3 minutes',
        sourceTier: 'editorial',
        candidatePageType: 'review_site',
        shoppingEligible: false,
      }),
      candidate({
        merchantUrl: 'https://www.nike.com/t/alphafly-3',
        price: '$295',
        currency: 'USD',
        sourceTier: 'official',
        candidatePageType: 'official_product',
        shoppingEligible: true,
      }),
    ]);

    assert.equal(merged.price, '$295');
    assert.equal(merged.metadataSourceMap.price?.source, 'nike.com');
  });
});
