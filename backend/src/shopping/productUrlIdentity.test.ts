import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAmazonMarketplaceHost,
  isExactProductBuyingUrl,
  isMarketplaceHost,
} from './productUrlIdentity';

describe('productUrlIdentity', () => {
  it('treats Amazon short-link hosts as marketplace', () => {
    for (const host of ['amzn.in', 'www.amzn.in', 'amzn.com', 'a.co', 'www.amazon.in', 'amazon.com']) {
      assert.equal(isAmazonMarketplaceHost(host), true, host);
      assert.equal(isMarketplaceHost(host), true, host);
    }
    assert.equal(isAmazonMarketplaceHost('playstation.com'), false);
    assert.equal(isMarketplaceHost('flipkart.com'), true);
  });

  it('treats Amazon short /d/{id} URLs as exact product buying URLs', () => {
    assert.equal(isExactProductBuyingUrl('https://amzn.in/d/01fhRXW8'), true);
    assert.equal(isExactProductBuyingUrl('https://amzn.in/d/0b57Rkqt'), true);
    assert.equal(isExactProductBuyingUrl('https://amzn.com/d/abc123'), true);
    assert.equal(isExactProductBuyingUrl('https://a.co/d/xyz789'), true);
    assert.equal(isExactProductBuyingUrl('https://www.amazon.in/dp/B0DGHYQCTQ'), true);
  });

  it('still rejects Amazon homepages and brand hubs', () => {
    assert.equal(isExactProductBuyingUrl('https://www.amazon.in/'), false);
    assert.equal(isExactProductBuyingUrl('https://amzn.in/'), false);
    assert.equal(isExactProductBuyingUrl('https://www.apple.com/iphone/'), false);
  });
});
