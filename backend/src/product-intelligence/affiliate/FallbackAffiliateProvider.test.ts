import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FallbackAffiliateProvider } from './FallbackAffiliateProvider';

describe('FallbackAffiliateProvider', () => {
  it('builds go.link from merchant URL without treating it as merchant', async () => {
    const p = new FallbackAffiliateProvider(null, 1000);
    const r = await p.resolve({
      merchantUrl: 'https://shop.example/p/1',
      catalogProductId: null,
    });
    assert.equal(r.provider, 'fallback');
    assert.ok(r.affiliateUrl.includes('mystash.go.link'));
    assert.ok(r.affiliateUrl.includes(encodeURIComponent('https://shop.example/p/1')));
  });
});
