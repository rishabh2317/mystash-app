import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchCandidate } from '../domain/types';
import {
  amazonPreferredSearchQuery,
  isAmazonPreferredMetadataCandidate,
  isOfficialPreferredMetadataCandidate,
  officialPreferredSearchQuery,
  pickPreferredMetadataTargets,
  shouldStopAfterPreferredMetadata,
} from './preferredMetadataTargets';

function candidate(partial: Partial<SearchCandidate> & { merchantUrl: string }): SearchCandidate {
  return {
    merchant: 'x',
    title: 't',
    image: null,
    score: 1,
    ...partial,
  };
}

describe('pickPreferredMetadataTargets', () => {
  it('selects official then Amazon and ignores other merchants', () => {
    const apple = candidate({
      merchantUrl: 'https://www.apple.com/in/macbook-air/',
      sourceType: 'OFFICIAL',
      sourceTier: 'official',
      pageType: 'PRODUCT',
    });
    const bestbuy = candidate({
      merchantUrl: 'https://www.bestbuy.com/site/macbook/123.p',
      sourceType: 'RETAILER',
      sourceTier: 'retailer',
      pageType: 'PRODUCT',
    });
    const amazon = candidate({
      merchantUrl: 'https://www.amazon.in/dp/mac',
      sourceType: 'MARKETPLACE',
      sourceTier: 'marketplace',
      pageType: 'PRODUCT',
    });

    const picked = pickPreferredMetadataTargets([bestbuy, amazon, apple]);
    assert.deepEqual(
      picked.map((c) => c.merchantUrl),
      [apple.merchantUrl, amazon.merchantUrl],
    );
    assert.equal(isOfficialPreferredMetadataCandidate(apple), true);
    assert.equal(isAmazonPreferredMetadataCandidate(amazon), true);
    assert.equal(isOfficialPreferredMetadataCandidate(bestbuy), false);
    assert.equal(isAmazonPreferredMetadataCandidate(bestbuy), false);
  });

  it('returns only Amazon when Official is missing', () => {
    const amazon = candidate({
      merchantUrl: 'https://www.amazon.com/dp/B0X',
      sourceType: 'MARKETPLACE',
      pageType: 'PRODUCT',
    });
    const bestbuy = candidate({
      merchantUrl: 'https://www.bestbuy.com/site/x/1.p',
      sourceType: 'RETAILER',
      pageType: 'PRODUCT',
    });
    const picked = pickPreferredMetadataTargets([bestbuy, amazon]);
    assert.deepEqual(
      picked.map((c) => c.merchantUrl),
      [amazon.merchantUrl],
    );
  });

  it('returns only Official when Amazon is missing', () => {
    const official = candidate({
      merchantUrl: 'https://www.sony.com/electronics/x',
      sourceType: 'OFFICIAL',
      sourceTier: 'official',
      pageType: 'PRODUCT',
    });
    const picked = pickPreferredMetadataTargets([official]);
    assert.equal(picked.length, 1);
    assert.equal(picked[0]?.merchantUrl, official.merchantUrl);
  });

  it('enriches only the best canonical official PDP among regional duplicates', () => {
    const appleIn = candidate({
      merchantUrl: 'https://www.apple.com/in/macbook-air/',
      sourceType: 'OFFICIAL',
      sourceTier: 'official',
      pageType: 'PRODUCT',
      pdpScore: 40,
    });
    const appleUs = candidate({
      merchantUrl: 'https://www.apple.com/us/macbook-air/',
      sourceType: 'OFFICIAL',
      sourceTier: 'official',
      pageType: 'PRODUCT',
      pdpScore: 90,
    });
    const appleShop = candidate({
      merchantUrl: 'https://www.apple.com/shop/buy-mac/macbook-air',
      sourceType: 'OFFICIAL',
      sourceTier: 'official',
      pageType: 'PRODUCT',
      pdpScore: 70,
    });
    const amazon = candidate({
      merchantUrl: 'https://www.amazon.com/dp/B0MAC',
      sourceType: 'MARKETPLACE',
      pageType: 'PRODUCT',
      pdpScore: 80,
    });
    const picked = pickPreferredMetadataTargets([appleIn, appleShop, amazon, appleUs]);
    assert.deepEqual(
      picked.map((c) => c.merchantUrl),
      [appleUs.merchantUrl, amazon.merchantUrl],
    );
  });
});

describe('shouldStopAfterPreferredMetadata', () => {
  it('stops at 90% completeness without consulting commerce', () => {
    assert.equal(shouldStopAfterPreferredMetadata(90), true);
    assert.equal(shouldStopAfterPreferredMetadata(89), false);
    assert.equal(shouldStopAfterPreferredMetadata(100), true);
  });
});

describe('preferred discovery queries', () => {
  it('builds targeted preferred discovery queries from the identified product', () => {
    assert.equal(
      officialPreferredSearchQuery('MacBook Air M4', 'Apple'),
      'Apple MacBook Air M4 official',
    );
    assert.equal(officialPreferredSearchQuery('Apple MacBook Air', 'Apple'), 'Apple MacBook Air official');
    assert.equal(amazonPreferredSearchQuery('MacBook Air M4'), 'MacBook Air M4 site:amazon.com');
  });
});
