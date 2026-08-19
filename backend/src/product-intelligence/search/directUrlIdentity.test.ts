import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isStrongDirectUrlCandidate, merchantUrlsMatch } from './directUrlIdentity';
import type { SearchCandidate } from '../domain/types';

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    merchant: 'shop.example',
    merchantUrl: 'https://shop.example/products/x',
    title: 'Example Product',
    image: 'https://img.example/x.jpg',
    score: 1,
    enrichmentSucceeded: true,
    pdpVerdict: 'pdp',
    pdpScore: 0.7,
    ...overrides,
  };
}

describe('isStrongDirectUrlCandidate', () => {
  it('accepts an enriched PDP', () => {
    assert.equal(isStrongDirectUrlCandidate(candidate()), true);
  });

  it('rejects enrichment failure, missing title, or not_pdp', () => {
    assert.equal(isStrongDirectUrlCandidate(candidate({ enrichmentSucceeded: false })), false);
    assert.equal(isStrongDirectUrlCandidate(candidate({ title: ' ' })), false);
    assert.equal(isStrongDirectUrlCandidate(candidate({ pdpVerdict: 'not_pdp' })), false);
  });

  it('rejects uncertain pages below the existing PDP classifier floor', () => {
    assert.equal(
      isStrongDirectUrlCandidate(candidate({ pdpVerdict: 'uncertain', pdpScore: 0.2 })),
      false,
    );
  });
});

describe('merchantUrlsMatch', () => {
  it('treats trailing slash and www as the same identity', () => {
    assert.equal(
      merchantUrlsMatch('https://www.amazon.com/dp/B0747YTV7B/', 'https://amazon.com/dp/B0747YTV7B'),
      true,
    );
    assert.equal(
      merchantUrlsMatch('https://www.playstation.com/en-us/ps-vr/', 'https://www.amazon.com/dp/B0747YTV7B'),
      false,
    );
  });
});
