import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractJsonLdPrice } from './extract/jsonLd';
import { extractMetaPrice } from './extract/metaTags';
import { extractEmbeddedStatePrice } from './extract/embeddedState';
import { resolveMerchantRegion, parseRegionalUrls } from './MerchantRegionResolver';
import { MerchantPricingService } from './MerchantPricingService';
import { LivePriceCache } from './cache';
import { getMerchantPricingConfig, resetMerchantPricingConfigCache } from './config';
import { createHttpStructuredAdapter } from './adapters/HttpStructuredAdapter';
import { createMerchantSpecificAdapter } from './adapters/MerchantSpecificAdapter';
import { resolveCountryCode, countryFromLocale } from './country';
import type { MerchantPricingOfferInput } from './types';

function offer(partial: Partial<MerchantPricingOfferInput> & { offerId: string; url: string }): MerchantPricingOfferInput {
  return {
    merchant: 'Amazon',
    price: '69999',
    currency: 'INR',
    availability: 'InStock',
    regionalUrls: null,
    ...partial,
  };
}

function cfg(overrides: Partial<ReturnType<typeof getMerchantPricingConfig>> = {}) {
  resetMerchantPricingConfigCache();
  return { ...getMerchantPricingConfig(), ...overrides };
}

describe('merchant pricing extractors', () => {
  it('extracts schema.org JSON-LD Product/Offer price', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Phone","offers":{"@type":"Offer","price":"69999","priceCurrency":"INR","availability":"https://schema.org/InStock"}}
      </script>`;
    const extracted = extractJsonLdPrice(html);
    assert.equal(extracted?.price, '69999');
    assert.equal(extracted?.currency, 'INR');
    assert.equal(extracted?.availability, 'InStock');
  });

  it('extracts structured meta tag prices', () => {
    const html = `
      <meta property="product:price:amount" content="299.00" />
      <meta property="product:price:currency" content="USD" />`;
    const extracted = extractMetaPrice(html);
    assert.equal(extracted?.price, '299.00');
    assert.equal(extracted?.currency, 'USD');
  });

  it('extracts embedded product state price', () => {
    const html = `window.__STATE__={"priceToPay":{"amount":449.99},"priceCurrency":"USD"}`;
    const extracted = extractEmbeddedStatePrice(html);
    assert.equal(extracted?.price, '449.99');
    assert.equal(extracted?.currency, 'USD');
  });

  it('does not fabricate a price from free text', () => {
    const html = `<html><body><p>About 500 people love this roughly $something product</p></body></html>`;
    assert.equal(extractJsonLdPrice(html), null);
    assert.equal(extractMetaPrice(html), null);
    assert.equal(extractEmbeddedStatePrice(html), null);
  });
});

describe('MerchantRegionResolver', () => {
  it('resolves explicit regional URLs for IN/US/GB', () => {
    const regionalUrls = {
      IN: 'https://www.amazon.in/dp/IN1',
      US: 'https://www.amazon.com/dp/US1',
      GB: 'https://www.amazon.co.uk/dp/GB1',
    };
    assert.equal(
      resolveMerchantRegion({ url: 'https://www.amazon.com/dp/US1', regionalUrls }, 'IN').url,
      'https://www.amazon.in/dp/IN1',
    );
    assert.equal(
      resolveMerchantRegion({ url: 'https://www.amazon.com/dp/US1', regionalUrls }, 'US').url,
      'https://www.amazon.com/dp/US1',
    );
    assert.equal(
      resolveMerchantRegion({ url: 'https://www.amazon.com/dp/US1', regionalUrls }, 'GB').url,
      'https://www.amazon.co.uk/dp/GB1',
    );
  });

  it('uses original URL when regional URL does not exist', () => {
    const result = resolveMerchantRegion(
      { url: 'https://www.sony.com/headphones', regionalUrls: { US: 'https://www.sony.com/us/h' } },
      'IN',
    );
    assert.equal(result.url, 'https://www.sony.com/headphones');
    assert.equal(result.usedRegional, false);
  });

  it('never invents localized URLs from TLD rewriting', () => {
    const result = resolveMerchantRegion(
      { url: 'https://www.amazon.com/dp/X', regionalUrls: null },
      'IN',
    );
    assert.equal(result.url, 'https://www.amazon.com/dp/X');
    assert.equal(parseRegionalUrls({ IN: 'not-a-url' }), null);
  });
});

describe('MerchantPricingService', () => {
  it('returns live price on success and keeps DB fallback on failure', async () => {
    const htmlByUrl: Record<string, string> = {
      'https://shop.example/a': `<script type="application/ld+json">{"@type":"Product","offers":{"price":"100","priceCurrency":"USD"}}</script>`,
      'https://shop.example/b': `<html>no price here</html>`,
    };
    const service = new MerchantPricingService(
      cfg({ maxConcurrency: 2, maxOffersPerPage: 8, cacheTtlMs: 45_000 }),
      [createHttpStructuredAdapter()],
      new LivePriceCache(45_000),
      async (url) => ({ status: 200, body: htmlByUrl[url] ?? '' }),
    );

    const payload = await service.getLivePrices({
      productId: 'p1',
      country: 'US',
      offers: [
        offer({ offerId: 'a', url: 'https://shop.example/a', price: '90', currency: 'USD' }),
        offer({ offerId: 'b', url: 'https://shop.example/b', price: '80', currency: 'USD', merchant: 'Other' }),
      ],
    });

    assert.equal(payload.results.length, 2);
    const live = payload.results.find((r) => r.offerId === 'a')!;
    const stale = payload.results.find((r) => r.offerId === 'b')!;
    assert.equal(live.source, 'live');
    assert.equal(live.status, 'success');
    assert.equal(live.price, '100');
    assert.equal(stale.source, 'fallback');
    assert.equal(stale.price, '80');
    assert.notEqual(stale.status, 'success');
  });

  it('one merchant failure does not fail all offers', async () => {
    const service = new MerchantPricingService(
      cfg({ maxConcurrency: 2 }),
      [createHttpStructuredAdapter()],
      new LivePriceCache(1_000),
      async (url) => {
        if (url.includes('fail')) throw new Error('boom');
        return {
          status: 200,
          body: `<script type="application/ld+json">{"@type":"Product","offers":{"price":"12","priceCurrency":"USD"}}</script>`,
        };
      },
    );

    const payload = await service.getLivePrices({
      productId: 'p1',
      country: 'US',
      offers: [
        offer({ offerId: 'ok', url: 'https://shop.example/ok', price: '1' }),
        offer({ offerId: 'bad', url: 'https://shop.example/fail', price: '2' }),
      ],
    });

    assert.equal(payload.results.find((r) => r.offerId === 'ok')?.status, 'success');
    assert.equal(payload.results.find((r) => r.offerId === 'bad')?.source, 'fallback');
    assert.equal(payload.results.find((r) => r.offerId === 'bad')?.price, '2');
  });

  it('reports timeout and blocked without fabricating prices', async () => {
    const service = new MerchantPricingService(
      cfg(),
      [createHttpStructuredAdapter()],
      new LivePriceCache(1_000),
      async (url) => {
        if (url.includes('blocked')) return { status: 403, body: '', blocked: true };
        return { status: 0, body: '' };
      },
    );

    const payload = await service.getLivePrices({
      productId: 'p1',
      country: 'US',
      offers: [
        offer({ offerId: 't', url: 'https://shop.example/timeout', price: '10' }),
        offer({ offerId: 'b', url: 'https://shop.example/blocked', price: '11' }),
      ],
    });

    assert.equal(payload.results.find((r) => r.offerId === 't')?.status, 'timeout');
    assert.equal(payload.results.find((r) => r.offerId === 'b')?.status, 'blocked');
    assert.equal(payload.results.find((r) => r.offerId === 't')?.price, '10');
    assert.equal(payload.results.find((r) => r.offerId === 'b')?.source, 'fallback');
  });

  it('short cache/deduplication avoids repeat fetches', async () => {
    let hits = 0;
    const cache = new LivePriceCache(60_000);
    const service = new MerchantPricingService(
      cfg({ cacheTtlMs: 60_000 }),
      [createHttpStructuredAdapter()],
      cache,
      async () => {
        hits += 1;
        return {
          status: 200,
          body: `<script type="application/ld+json">{"@type":"Product","offers":{"price":"5","priceCurrency":"USD"}}</script>`,
        };
      },
    );

    const input = {
      productId: 'p1',
      country: 'US',
      offers: [offer({ offerId: 'a', url: 'https://shop.example/a' })],
    };
    await service.getLivePrices(input);
    await service.getLivePrices(input);
    assert.equal(hits, 1);
  });

  it('live price uses the same resolved regional URL as Buy', async () => {
    const seen: string[] = [];
    const regionalUrls = {
      IN: 'https://www.amazon.in/dp/IN1',
      US: 'https://www.amazon.com/dp/US1',
    };
    const service = new MerchantPricingService(
      cfg(),
      [createHttpStructuredAdapter()],
      new LivePriceCache(1_000),
      async (url) => {
        seen.push(url);
        return {
          status: 200,
          body: `<script type="application/ld+json">{"@type":"Product","offers":{"price":"69999","priceCurrency":"INR"}}</script>`,
        };
      },
    );

    const payload = await service.getLivePrices({
      productId: 'p1',
      country: 'IN',
      offers: [
        offer({
          offerId: 'amz',
          url: 'https://www.amazon.com/dp/US1',
          regionalUrls,
          price: '65000',
          currency: 'INR',
        }),
      ],
    });

    assert.deepEqual(seen, ['https://www.amazon.in/dp/IN1']);
    assert.equal(payload.results[0]?.merchantUrl, 'https://www.amazon.in/dp/IN1');
    assert.equal(payload.results[0]?.price, '69999');
    assert.equal(
      resolveMerchantRegion({ url: 'https://www.amazon.com/dp/US1', regionalUrls }, 'IN').url,
      payload.results[0]?.merchantUrl,
    );
  });

  it('keeps all existing merchant offers present', async () => {
    const service = new MerchantPricingService(
      cfg({ maxOffersPerPage: 2 }),
      [createHttpStructuredAdapter()],
      new LivePriceCache(1_000),
      async () => ({ status: 200, body: '<html></html>' }),
    );
    const payload = await service.getLivePrices({
      productId: 'p1',
      country: 'US',
      offers: [
        offer({ offerId: '1', url: 'https://a.example/1' }),
        offer({ offerId: '2', url: 'https://a.example/2' }),
        offer({ offerId: '3', url: 'https://a.example/3' }),
      ],
    });
    assert.equal(payload.results.length, 3);
    assert.deepEqual(
      payload.results.map((r) => r.offerId),
      ['1', '2', '3'],
    );
  });

  it('supports merchant-specific adapter hooks', async () => {
    const service = new MerchantPricingService(
      cfg(),
      [
        createMerchantSpecificAdapter({
          'special.example': () => ({ price: '42', currency: 'USD', availability: null }),
        }),
      ],
      new LivePriceCache(1_000),
      async () => ({ status: 200, body: '<html></html>' }),
    );
    const payload = await service.getLivePrices({
      productId: 'p1',
      country: 'US',
      offers: [offer({ offerId: 's', url: 'https://special.example/p', price: '1' })],
    });
    assert.equal(payload.results[0]?.price, '42');
    assert.equal(payload.results[0]?.source, 'live');
  });
});

describe('country resolution', () => {
  it('prefers explicit then profile then locale then default', () => {
    assert.equal(resolveCountryCode({ explicit: 'GB' }), 'GB');
    assert.equal(resolveCountryCode({ profile: 'US', deviceLocale: 'en-IN' }), 'US');
    assert.equal(countryFromLocale('en-IN'), 'IN');
    assert.equal(resolveCountryCode({ deviceLocale: 'en-GB' }), 'GB');
  });
});
