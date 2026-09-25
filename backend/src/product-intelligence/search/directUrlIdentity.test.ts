import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAffiliateOrSocialRedirectUrl,
  isQualifyingMerchantSeedUrl,
  isStrongDirectUrlCandidate,
  merchantUrlsMatch,
} from './directUrlIdentity';
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

describe('isAffiliateOrSocialRedirectUrl / isQualifyingMerchantSeedUrl', () => {
  it('treats Liketk and rstyle as affiliate redirects, not discovery seeds', () => {
    assert.equal(isAffiliateOrSocialRedirectUrl('https://liketk.it/abc123'), true);
    assert.equal(isAffiliateOrSocialRedirectUrl('https://www.rstyle.me/n/xyz'), true);
    assert.equal(isQualifyingMerchantSeedUrl('https://liketk.it/abc123'), false);
    assert.equal(isQualifyingMerchantSeedUrl('https://www.rstyle.me/n/xyz'), false);
  });

  it('treats Instagram / YouTube media URLs as non-seeds', () => {
    assert.equal(
      isQualifyingMerchantSeedUrl('https://www.instagram.com/reel/ABC123/'),
      false,
    );
    assert.equal(
      isQualifyingMerchantSeedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
      false,
    );
  });

  it('accepts genuine marketplace / retailer PDPs as seeds', () => {
    assert.equal(
      isQualifyingMerchantSeedUrl('https://www.amazon.com/dp/B0747YTV7B'),
      true,
    );
    assert.equal(
      isQualifyingMerchantSeedUrl('https://www.zara.com/in/en/product-p12345678.html'),
      true,
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
