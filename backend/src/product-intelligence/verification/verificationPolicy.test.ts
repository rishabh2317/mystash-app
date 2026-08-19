import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideProductVerification } from './verificationPolicy';
import type { MatchScoreResult } from '../domain/types';

function match(partial: Partial<MatchScoreResult> & Pick<MatchScoreResult, 'score' | 'reason'>): MatchScoreResult {
  return {
    matchConfidence: partial.score,
    components: partial.components ?? {
      title: 0,
      brand: 0,
      model: 0,
      candidate: 0,
    },
    ...partial,
  };
}

describe('decideProductVerification', () => {
  const cfg = {
    catalogHitMinScore: 0.85,
    verificationMatchMin: 0.45,
    pdpClassifierMin: 0.45,
  };

  it('rejects iPhone 16e-style weak identity even when a commerce offer exists', () => {
    // title=0.50 brand=0.40 model=0.00 → ~0.475 with high candidate score
    const weak = match({
      score: 0.475,
      reason: 'title=0.50 brand=0.40 model=0.00',
      components: { title: 0.5, brand: 0.4, model: 0, candidate: 1 },
    });
    const result = decideProductVerification({
      hasCommerceOffer: true,
      bestMatch: weak,
      identityUrl: 'https://www.apple.com/iphone/',
      bestPdpScore: 0.47,
      hadExistingCatalog: false,
      ...cfg,
    });
    assert.equal(result.verificationStatus, 'UNVERIFIED');
    assert.equal(result.decision, 'created_unverified_weak_identity');
    assert.equal(result.identityPath, 'none');
  });

  it('verifies strong identity matches (iPhone 15 / Nike-style)', () => {
    const strong = match({
      score: 0.985,
      reason: 'title=1.00 brand=1.00 model=1.00',
      components: { title: 1, brand: 1, model: 1, candidate: 0.9 },
    });
    const result = decideProductVerification({
      hasCommerceOffer: true,
      bestMatch: strong,
      identityUrl: 'https://shop.example/p/iphone-15',
      bestPdpScore: 0.8,
      hadExistingCatalog: false,
      ...cfg,
    });
    assert.equal(result.verificationStatus, 'VERIFIED');
    assert.equal(result.identityPath, 'strong_match');
    assert.equal(result.decision, 'created_verified');
  });

  it('allows exact buying URL path when match clears verificationMatchMin', () => {
    const borderline = match({
      score: 0.5,
      reason: 'title=0.60 brand=0.40 model=0.00',
      components: { title: 0.6, brand: 0.4, model: 0, candidate: 0.5 },
    });
    const result = decideProductVerification({
      hasCommerceOffer: true,
      bestMatch: borderline,
      identityUrl: 'https://www.amazon.in/dp/B0DGHYQCTQ',
      bestPdpScore: 0.79,
      hadExistingCatalog: false,
      ...cfg,
    });
    assert.equal(result.verificationStatus, 'VERIFIED');
    assert.equal(result.identityPath, 'exact_buying_url');
  });

  it('allows Amazon short /d/{id} URLs as the exact buying URL path', () => {
    const borderline = match({
      score: 0.76,
      reason: 'title=0.80 brand=1.00 model=0.00',
      components: { title: 0.8, brand: 1, model: 0, candidate: 0.5 },
    });
    const result = decideProductVerification({
      hasCommerceOffer: true,
      bestMatch: borderline,
      identityUrl: 'https://amzn.in/d/01fhRXW8',
      bestPdpScore: 0.53,
      hadExistingCatalog: false,
      ...cfg,
    });
    assert.equal(result.verificationStatus, 'VERIFIED');
    assert.equal(result.identityPath, 'exact_buying_url');
    assert.equal(result.decision, 'created_verified');
  });

  it('stays metadata-only when no commerce offer exists', () => {
    const strong = match({
      score: 0.99,
      reason: 'title=1.00 brand=1.00 model=1.00',
      components: { title: 1, brand: 1, model: 1, candidate: 1 },
    });
    const result = decideProductVerification({
      hasCommerceOffer: false,
      bestMatch: strong,
      identityUrl: null,
      bestPdpScore: 0,
      hadExistingCatalog: false,
      ...cfg,
    });
    assert.equal(result.verificationStatus, 'UNVERIFIED');
    assert.equal(result.decision, 'created_metadata_only');
  });
});
