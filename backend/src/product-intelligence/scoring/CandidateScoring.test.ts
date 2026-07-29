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
    shoppingEligible: true,
    enrichmentMeta: {
      specifications: { Color: 'Black' },
      availability: 'In stock',
    },
    ...partial,
  };
}

describe('CandidateScoring', () => {
  it('uses reusable page authority without merchant-specific rules', () => {
    assert.equal(sourceAuthorityFor('official_product'), 100);
    assert.equal(sourceAuthorityFor('retailer_pdp'), 85);
    assert.equal(sourceAuthorityFor('review_site'), 40);
    assert.equal(sourceAuthorityFor('official_brand_news'), 30);
  });

  it('keeps metadata and shopping scores independent', () => {
    const editorial = scoreCandidateDecisions(
      candidate({
        candidatePageType: 'review_site',
        sourceTier: 'editorial',
        shoppingEligible: false,
        description: 'Detailed editorial description of this exact product and its specifications.',
      }),
    );
    const official = scoreCandidateDecisions(
      candidate({
        merchantUrl: 'https://brand.example/product/1',
        candidatePageType: 'official_product',
        sourceTier: 'official',
      }),
    );

    assert.ok(editorial.metadataScore > 0);
    assert.equal(editorial.shoppingScore, 0);
    assert.ok(official.metadataScore > editorial.metadataScore);
    assert.ok(official.shoppingScore > 0);
  });
});
