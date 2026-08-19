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

  it('uses the centralized specifications policy before candidate size', () => {
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
    assert.equal(Object.keys(merged.specifications).length, 3);
    assert.equal(merged.metadataSourceMap.specifications?.source, 'bestbuy.com');
  });

  it('keeps an official title over a longer editorial headline', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://www.adidas.com/us/f50-elite-firm-ground-cleats/ABC.html',
        title: 'F50 Elite Firm Ground Cleats',
        sourceTier: 'official',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
      }),
      candidate({
        merchantUrl: 'https://football.example/messi-boots-review',
        title: 'Messi Boots 2026 What Does Messi Wear Adidas F50 Complete Review',
        sourceTier: 'editorial',
        sourceType: 'REVIEW',
        pageType: 'REVIEW',
        capabilities: {
          metadata: true,
          commerce: false,
          specifications: true,
          images: true,
          evidence: true,
        },
        description: 'A very long editorial description with extensive product context and analysis.',
      }),
    ]);

    assert.equal(merged.title, 'F50 Elite Firm Ground Cleats');
    assert.equal(merged.metadataSourceMap.title?.source, 'adidas.com');
    assert.equal(merged.metadataSourceMap.title?.sourceType, 'OFFICIAL');
    assert.equal(merged.metadataSourceMap.title?.pageType, 'PRODUCT');
    assert.equal(merged.metadataSourceMap.title?.trustRank, 0);
  });

  it('uses input order within one trust rule and ignores metadataScore', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://first-market.example/product/phone',
        title: 'First Marketplace Title',
        sourceType: 'MARKETPLACE',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        metadataScore: 1,
      }),
      candidate({
        merchantUrl: 'https://second-market.example/product/phone',
        title: 'Second Marketplace Title',
        sourceType: 'MARKETPLACE',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        metadataScore: 100,
      }),
    ]);

    assert.equal(merged.title, 'First Marketplace Title');
  });

  it('does not use metadata capability as a candidate admission gate', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://review.example/reviews/phone',
        title: 'Trusted Review Product Name',
        description: 'Useful review description',
        image: 'https://review.example/product.jpg',
        price: '$99',
        currency: 'USD',
        sourceType: 'REVIEW',
        pageType: 'REVIEW',
        capabilities: {
          metadata: false,
          commerce: false,
          specifications: false,
          images: false,
          evidence: true,
        },
        enrichmentMeta: {
          specifications: { Color: 'Black' },
          evidence: { reviewed: true },
        },
      }),
    ]);

    assert.equal(merged.title, 'Trusted Review Product Name');
    assert.equal(merged.description, 'Useful review description');
    assert.equal(merged.heroImage, null);
    assert.equal(merged.price, null);
    assert.deepEqual(merged.specifications, {});
    assert.deepEqual(merged.evidence, { reviewed: true });
  });

  it('uses commerce capability for commerce field contribution', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://brand.example/product/phone',
        title: 'Official Product Name',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: false,
          commerce: false,
          specifications: true,
          images: true,
          evidence: true,
        },
        price: '$99',
        currency: 'USD',
        enrichmentMeta: { availability: 'InStock' },
      }),
    ]);

    assert.equal(merged.title, 'Official Product Name');
    assert.equal(merged.price, null);
    assert.equal(merged.currency, null);
    assert.equal(merged.availability, null);
    assert.equal(merged.merchant, null);
  });

  it('selects price, currency, availability, and merchant as one atomic offer', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchant: 'Candidate A',
        merchantUrl: 'https://a.example/product/phone',
        sourceType: 'RETAILER',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        price: 'USD 100',
        currency: null,
        affiliateUrl: 'https://a.example/affiliate/phone',
        offerId: 'offer-a',
        enrichmentMeta: { availability: 'InStock' },
      }),
      candidate({
        merchant: 'Candidate B',
        merchantUrl: 'https://b.example/product/phone',
        sourceType: 'RETAILER',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        price: '200',
        currency: 'EUR',
        enrichmentMeta: { availability: 'PreOrder' },
      }),
    ]);

    assert.deepEqual(merged.offer, {
      price: 'USD 100',
      currency: null,
      availability: 'InStock',
      merchant: 'Candidate A',
      merchantUrl: 'https://a.example/product/phone',
      affiliateUrl: 'https://a.example/affiliate/phone',
      offerId: 'offer-a',
    });
    assert.equal(merged.price, 'USD 100');
    assert.equal(merged.currency, null);
    assert.equal(merged.availability, 'InStock');
    assert.equal(merged.merchant, 'Candidate A');
    assert.equal(merged.metadataSourceMap.price?.source, 'a.example');
    assert.equal(merged.metadataSourceMap.currency, undefined);
  });

  it('unions sources and frame refs while merging evidence', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://brand.example/product/phone',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        enrichmentMeta: {
          sources: ['merchant', 'shared'],
          frameRefs: [1, 'frame-2'],
          evidence: { official: true },
        },
      }),
      candidate({
        merchantUrl: 'https://market.example/product/phone',
        sourceType: 'MARKETPLACE',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        enrichmentMeta: {
          sources: ['shared', 'marketplace'],
          frameRefs: ['frame-2', 3],
          evidence: { marketplace: true },
        },
      }),
    ]);

    assert.deepEqual(merged.frameRefs, [1, 'frame-2', 3]);
    assert.ok(merged.metadataSources.includes('shared'));
    assert.deepEqual(merged.evidence, { official: true, marketplace: true });
  });

  it('merges evidence deeply with deterministic trust and provenance', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://review.example/reviews/phone',
        sourceType: 'REVIEW',
        pageType: 'REVIEW',
        capabilities: {
          metadata: true,
          commerce: false,
          specifications: true,
          images: true,
          evidence: true,
        },
        enrichmentMeta: {
          evidence: {
            verdict: 'review',
            tags: ['shared', 'review'],
            details: { color: 'blue', size: 'large' },
          },
        },
      }),
      candidate({
        merchantUrl: 'https://brand.example/product/phone',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        enrichmentMeta: {
          evidence: {
            verdict: 'official',
            tags: ['official', 'shared'],
            details: { color: 'black', weight: '1kg' },
          },
        },
      }),
    ]);

    assert.deepEqual(merged.evidence, {
      verdict: 'official',
      tags: ['official', 'shared', 'review'],
      details: { color: 'black', weight: '1kg', size: 'large' },
    });
    assert.deepEqual(
      merged.evidenceProvenance.verdict?.map((source) => source.source),
      ['brand.example', 'review.example'],
    );
    assert.deepEqual(
      merged.evidenceProvenance['details.color']?.map((source) => source.source),
      ['brand.example', 'review.example'],
    );
  });

  it('allows buying guides to contribute evidence but not metadata', () => {
    const merged = mergeEnrichedCandidates([
      candidate({
        merchantUrl: 'https://review.example/buying-guide/phones',
        title: 'Best Phones Under 50000',
        description: 'A multi-product buying guide',
        sourceType: 'REVIEW',
        pageType: 'BUYING_GUIDE',
        capabilities: {
          metadata: false,
          commerce: false,
          specifications: false,
          images: false,
          evidence: true,
        },
        enrichmentMeta: { evidence: { mentionedModels: ['Phone A', 'Phone B'] } },
      }),
    ]);

    assert.equal(merged.title, null);
    assert.equal(merged.description, null);
    assert.deepEqual(merged.evidence, {
      mentionedModels: ['Phone A', 'Phone B'],
    });
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
        sourceType: 'REVIEW',
        pageType: 'REVIEW',
        capabilities: {
          metadata: true,
          commerce: false,
          specifications: true,
          images: true,
          evidence: true,
        },
      }),
      candidate({
        merchantUrl: 'https://www.nike.com/t/alphafly-3',
        price: '$295',
        currency: 'USD',
        sourceTier: 'official',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
      }),
    ]);

    assert.equal(merged.price, '$295');
    assert.equal(merged.metadataSourceMap.price?.source, 'nike.com');
  });
});
