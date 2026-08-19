import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchCandidate } from '../domain/types';
import { scoreCandidateDecisions, sourceAuthorityFor } from './CandidateScoring';

function candidate(partial: Partial<SearchCandidate>): SearchCandidate {
  return {
    merchant: 'Merchant',
    merchantUrl: 'https://merchant.example/product/1',
    title: 'Example Product',
    image: 'https://images.example/product.jpg',
    score: 0.9,
    enrichmentSucceeded: true,
    pdpScore: 0.9,
    pdpVerdict: 'pdp',
    sourceType: 'RETAILER',
    pageType: 'PRODUCT',
    capabilities: {
      metadata: true,
      commerce: true,
      specifications: true,
      images: true,
      evidence: true,
    },
    enrichmentMeta: {
      specifications: { Color: 'Black' },
      availability: 'In stock',
    },
    ...partial,
  };
}

describe('CandidateScoring', () => {
  it('uses reusable page authority without merchant-specific rules', () => {
    assert.equal(sourceAuthorityFor('OFFICIAL'), 100);
    assert.equal(sourceAuthorityFor('RETAILER'), 85);
    assert.equal(sourceAuthorityFor('REVIEW'), 40);
    assert.equal(sourceAuthorityFor('NEWS'), 30);
  });

  it('keeps metadata and shopping scores independent', () => {
    const editorial = scoreCandidateDecisions(
      candidate({
        sourceType: 'REVIEW',
        pageType: 'REVIEW',
        capabilities: {
          metadata: true,
          commerce: false,
          specifications: true,
          images: true,
          evidence: true,
        },
        sourceTier: 'editorial',
        description: 'Detailed editorial description of this exact product and its specifications.',
      }),
    );
    const official = scoreCandidateDecisions(
      candidate({
        merchantUrl: 'https://brand.example/product/1',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        capabilities: {
          metadata: true,
          commerce: true,
          specifications: true,
          images: true,
          evidence: true,
        },
        sourceTier: 'official',
      }),
    );

    assert.ok(editorial.metadataScore > 0);
    assert.equal(editorial.shoppingScore, 0);
    assert.ok(official.metadataScore > editorial.metadataScore);
    assert.ok(official.shoppingScore > 0);
  });

  it('scores exact PDPs above official brand hubs', () => {
    const hub = scoreCandidateDecisions(
      candidate({
        merchantUrl: 'https://www.apple.com/iphone/',
        merchant: 'Apple',
        sourceType: 'OFFICIAL',
        pageType: 'PRODUCT',
        pdpScore: 0.47,
        sourceTier: 'official',
      }),
      { merchantPriority: 9 },
    );
    const exact = scoreCandidateDecisions(
      candidate({
        merchantUrl: 'https://www.amazon.in/dp/B0CHX3QBCH',
        merchant: 'Amazon',
        sourceType: 'MARKETPLACE',
        pageType: 'PRODUCT',
        pdpScore: 0.79,
        sourceTier: 'marketplace',
      }),
      { merchantPriority: 10 },
    );
    assert.ok(exact.destinationSpecificity > hub.destinationSpecificity);
    assert.ok(exact.shoppingScore > hub.shoppingScore);
  });
});
