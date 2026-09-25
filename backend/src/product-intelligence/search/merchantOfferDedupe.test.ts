import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchCandidate } from '../domain/types';
import {
  amazonSiteHostForCountry,
  marketplaceSiteHostsForCountry,
  resolveDiscoveryCountry,
} from './discoveryCountry';
import {
  merchantOfferGroupKey,
  pickOneOfferPerMerchant,
  rankMerchantOfferCandidate,
} from './merchantOfferDedupe';

function candidate(
  partial: Partial<SearchCandidate> & { merchantUrl: string },
): SearchCandidate {
  return {
    merchant: 'x',
    title: 'PlayStation 5',
    image: null,
    score: 0.9,
    enrichmentSucceeded: true,
    pdpVerdict: 'pdp',
    pdpScore: 0.7,
    pageType: 'PRODUCT',
    sourceType: 'MARKETPLACE',
    capabilities: {
      metadata: true,
      commerce: true,
      specifications: true,
      images: true,
      evidence: true,
    },
    ...partial,
  };
}

describe('discoveryCountry', () => {
  it('maps IN / US / GB to regional Amazon hosts without inventing URL rewrites', () => {
    assert.equal(amazonSiteHostForCountry('IN'), 'amazon.in');
    assert.equal(amazonSiteHostForCountry('US'), 'amazon.com');
    assert.equal(amazonSiteHostForCountry('GB'), 'amazon.co.uk');
    assert.equal(amazonSiteHostForCountry(null), 'amazon.com');
    assert.equal(resolveDiscoveryCountry(null), 'IN');
  });

  it('exposes country marketplace site hints without suffix rewriting', () => {
    assert.ok(marketplaceSiteHostsForCountry('IN').includes('flipkart.com'));
    assert.ok(marketplaceSiteHostsForCountry('US').includes('walmart.com'));
    assert.ok(marketplaceSiteHostsForCountry('GB').includes('argos.co.uk'));
    assert.deepEqual(marketplaceSiteHostsForCountry(null), []);
  });
});

describe('pickOneOfferPerMerchant', () => {
  it('collapses five Amazon URLs into one Amazon offer', () => {
    const picked = pickOneOfferPerMerchant(
      [
        candidate({
          merchantUrl: 'https://www.amazon.com/s?k=ps5',
          pageType: 'SEARCH',
          pdpVerdict: 'not_pdp',
          pdpScore: 0.1,
        }),
        candidate({
          merchantUrl: 'https://www.amazon.com/stores/sony',
          pageType: 'HOMEPAGE',
          pdpVerdict: 'uncertain',
          pdpScore: 0.2,
        }),
        candidate({
          merchantUrl: 'https://www.amazon.com/dp/B0ABC111',
          pdpScore: 0.6,
        }),
        candidate({
          merchantUrl: 'https://www.amazon.com/dp/B0ABC222',
          pdpScore: 0.85,
        }),
        candidate({
          merchantUrl: 'https://www.amazon.com/gp/browse.html',
          pageType: 'CATEGORY',
          pdpScore: 0.3,
        }),
        candidate({
          merchantUrl: 'https://www.amazon.com/PlayStation-5/dp/B0BESTPDP',
          pdpScore: 0.9,
        }),
      ],
      'US',
    );
    assert.equal(picked.length, 1);
    assert.match(picked[0]!.merchantUrl, /B0BESTPDP|B0ABC222/);
    assert.equal(merchantOfferGroupKey(picked[0]!.merchantUrl), 'amazon');
  });

  it('prefers an Amazon PDP over Amazon store/search/category URLs', () => {
    const pdp = candidate({
      merchantUrl: 'https://www.amazon.in/dp/B0PS5',
      pageType: 'PRODUCT',
      pdpScore: 0.8,
    });
    const search = candidate({
      merchantUrl: 'https://www.amazon.in/s?k=ps5',
      pageType: 'SEARCH',
      pdpVerdict: 'not_pdp',
      pdpScore: 0.9,
    });
    const picked = pickOneOfferPerMerchant([search, pdp], 'IN');
    assert.equal(picked.length, 1);
    assert.equal(picked[0]!.merchantUrl, pdp.merchantUrl);
    assert.ok(rankMerchantOfferCandidate(pdp, 'IN') > rankMerchantOfferCandidate(search, 'IN'));
  });

  it('keeps Amazon + Flipkart + Sony as three separate offers', () => {
    const picked = pickOneOfferPerMerchant(
      [
        candidate({ merchantUrl: 'https://www.amazon.in/dp/B0PS5' }),
        candidate({
          merchantUrl: 'https://www.flipkart.com/sony-ps5/p/itm123',
          sourceType: 'MARKETPLACE',
        }),
        candidate({
          merchantUrl: 'https://www.sony.co.in/electronics/playstation-5',
          sourceType: 'OFFICIAL',
          sourceTier: 'official',
        }),
      ],
      'IN',
    );
    assert.equal(picked.length, 3);
    const hosts = picked.map((c) => new URL(c.merchantUrl).hostname);
    assert.ok(hosts.some((h) => /amazon/i.test(h)));
    assert.ok(hosts.some((h) => /flipkart/i.test(h)));
    assert.ok(hosts.some((h) => /sony/i.test(h)));
  });

  it('does not create multiple user-facing offers for variants on one merchant', () => {
    const picked = pickOneOfferPerMerchant(
      [
        candidate({ merchantUrl: 'https://www.amazon.com/dp/B0VARIANT_A', pdpScore: 0.7 }),
        candidate({ merchantUrl: 'https://www.amazon.com/dp/B0VARIANT_B', pdpScore: 0.75 }),
        candidate({ merchantUrl: 'https://amzn.in/d/01short', pdpScore: 0.6 }),
      ],
      'US',
    );
    assert.equal(picked.length, 1);
  });

  it('prefers country-aligned Amazon.in when country=IN', () => {
    const picked = pickOneOfferPerMerchant(
      [
        candidate({ merchantUrl: 'https://www.amazon.com/dp/B0US', pdpScore: 0.95 }),
        candidate({ merchantUrl: 'https://www.amazon.in/dp/B0IN', pdpScore: 0.7 }),
      ],
      'IN',
    );
    assert.equal(picked.length, 1);
    assert.match(picked[0]!.merchantUrl, /amazon\.in/);
  });
});
