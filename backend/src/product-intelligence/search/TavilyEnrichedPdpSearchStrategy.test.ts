import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchResult } from '../domain/types';
import { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import type { MerchantExtractor } from '../enrichment/MerchantExtractor';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import { pdpSearchHintsAls } from './pdpSearchHints';
import { TavilyEnrichedPdpSearchStrategy } from './TavilyEnrichedPdpSearchStrategy';

describe('TavilyEnrichedPdpSearchStrategy integration', () => {
  it('enriches multiple shortlisted PDPs instead of stopping at the first success', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'youtube.com',
              merchantUrl: 'https://www.youtube.com/watch?v=x',
              title: 'MacBook review',
              image: 'https://serper.example/should-ignore.jpg',
              score: 0.9,
            },
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: 'https://serper.example/also-ignore.jpg',
              score: 0.8,
            },
            {
              merchant: 'amazon.in',
              merchantUrl: 'https://www.amazon.in/dp/mac',
              title: 'Apple MacBook Air',
              image: null,
              score: 0.85,
            },
          ],
        };
      },
    };

    const extracted: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        const isApple = input.merchantUrl.includes('apple.com');
        return {
          title: isApple ? 'MacBook Air M4 13-inch' : 'Apple MacBook Air M4',
          brand: isApple ? 'Apple' : null,
          image: isApple ? 'https://store.apple.com/hero.jpg' : 'https://m.media-amazon.com/I/800x800.jpg',
          primaryImage: isApple
            ? 'https://store.apple.com/hero.jpg'
            : 'https://m.media-amazon.com/I/800x800.jpg',
          description: isApple ? 'The most capable MacBook Air yet with M4.' : null,
          merchantUrl: input.merchantUrl,
          price: isApple ? null : '99900',
          currency: isApple ? null : 'INR',
          specifications: isApple
            ? ({ Chip: 'M4' } as Record<string, string>)
            : ({ Display: '13.6 inch' } as Record<string, string>),
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };

    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
      5,
    );

    const result = await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' },
      () => strategy.search('Apple MacBook Air M4 laptops'),
    );

    assert.equal(result.kind, 'Succeeded');
    assert.equal(extracted.includes('https://www.youtube.com/watch?v=x'), false);
    assert.ok(extracted.includes('https://www.apple.com/in/macbook-air/'));
    assert.ok(extracted.includes('https://www.amazon.in/dp/mac'));
    assert.ok(maxInFlight >= 2, 'independent enrichments should overlap');
    if (result.kind === 'Succeeded') {
      assert.ok(result.candidates.length >= 2);
      assert.ok(result.candidates.every((c) => c.enrichmentSucceeded === true));
      assert.ok(result.candidates.some((c) => c.sourceType === 'OFFICIAL'));
      assert.ok(result.candidates.some((c) => /amazon\./i.test(c.merchantUrl)));
    }
  });

  it('tries the next ranked PDP when enrichment fails', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'nike.com',
              merchantUrl: 'https://nike.com/products/air-max-95',
              title: 'Nike Air Max 95',
              image: null,
              score: 0.95,
            },
            {
              merchant: 'shop.example',
              merchantUrl: 'https://shop.example/products/nike-air-max-95',
              title: 'Nike Air Max 95',
              image: null,
              score: 0.85,
            },
          ],
        };
      },
    };
    const attempted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        attempted.push(input.merchantUrl);
        if (input.merchantUrl.includes('nike.com')) return null;
        return {
          title: 'Nike Air Max 95',
          brand: 'Nike',
          merchantUrl: input.merchantUrl,
          image: 'https://shop.example/air-max.jpg',
          price: '189',
          currency: 'USD',
          specifications: { Color: 'Black' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest',
      'trace',
    );
    const result = await pdpSearchHintsAls.run(
      { brand: 'Nike', name: 'Nike Air Max 95', category: 'shoes' },
      () => strategy.search('Nike Air Max 95 product'),
    );
    assert.equal(result.kind, 'Succeeded');
    assert.equal(attempted.length, 2);
    if (result.kind === 'Succeeded') {
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0]?.merchantUrl, 'https://shop.example/products/nike-air-max-95');
      assert.equal(result.candidates[0]?.enrichmentSucceeded, true);
      assert.equal(result.candidates[0]?.pdpVerdict, 'pdp');
    }
  });

  it('skips Serper discovery when the creator-supplied URL is a strong PDP', async () => {
    let discoveryCalls = 0;
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        discoveryCalls += 1;
        return { kind: 'Succeeded', provider: 'serper', candidates: [] };
      },
    };
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        return {
          title: 'PlayStation VR Camera Bundle',
          brand: 'Sony',
          image: 'https://m.media-amazon.com/I/p.jpg',
          primaryImage: 'https://m.media-amazon.com/I/p.jpg',
          merchantUrl: input.merchantUrl,
          price: '205.02',
          currency: 'USD',
          specifications: { Platform: 'PS4' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    const seed = 'https://www.amazon.com/dp/B0747YTV7B';
    const result = await pdpSearchHintsAls.run(
      { brand: 'Sony', name: 'PlayStation VR Camera Bundle', category: 'gaming' },
      () =>
        strategy.search('PlayStation VR Camera Bundle', {
          seedMerchantUrl: seed,
          skipDiscoveryIfSeedStrong: true,
        }),
    );
    assert.equal(discoveryCalls, 0);
    assert.equal(result.kind, 'Succeeded');
    if (result.kind === 'Succeeded') {
      assert.equal(result.provider, 'direct_url');
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0]?.merchantUrl, seed);
    }
  });

  it('classifies Amazon short URLs as commerce-capable marketplace PDPs', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        throw new Error('Serper must not run for a strong Amazon short URL');
      },
    };
    let sawPartialCacheFlag: boolean | undefined;
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        sawPartialCacheFlag = input.acceptPartialCache;
        return {
          title: 'Xbox Series S',
          brand: 'Microsoft',
          image: 'https://img.example/xbox.jpg',
          primaryImage: 'https://img.example/xbox.jpg',
          description: 'All-digital next-gen console with 1TB storage.',
          merchantUrl: input.merchantUrl,
          price: '₹66,999.00',
          currency: 'INR',
          specifications: { Storage: '1TB' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    const seed = 'https://amzn.in/d/01fhRXW8';
    const result = await pdpSearchHintsAls.run(
      { brand: 'Microsoft', name: 'Xbox Series S', category: 'gaming' },
      () =>
        strategy.search('Xbox Series S', {
          seedMerchantUrl: seed,
          skipDiscoveryIfSeedStrong: true,
        }),
    );
    assert.equal(sawPartialCacheFlag, false);
    assert.equal(result.kind, 'Succeeded');
    if (result.kind === 'Succeeded') {
      const candidate = result.candidates[0];
      assert.equal(candidate?.merchantUrl, seed);
      assert.equal(candidate?.sourceType, 'MARKETPLACE');
      assert.equal(candidate?.pageType, 'PRODUCT');
      assert.equal(candidate?.capabilities?.commerce, true);
      assert.equal(candidate?.capabilities?.metadata, true);
      assert.notEqual(candidate?.sourceType, 'UNKNOWN');
    }
  });

  it('falls back to Serper when the supplied URL is not a product page', async () => {
    let discoveryCalls = 0;
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        discoveryCalls += 1;
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'amazon.com',
              merchantUrl: 'https://www.amazon.com/dp/B0747YTV7B',
              title: 'PlayStation VR',
              image: null,
              score: 0.9,
            },
          ],
        };
      },
    };
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        if (input.merchantUrl.includes('/blog/')) {
          return {
            title: 'Our latest VR news',
            brand: null,
            merchantUrl: input.merchantUrl,
            provider: 'mock',
            extractedAt: new Date().toISOString(),
          };
        }
        return {
          title: 'PlayStation VR Camera Bundle',
          brand: 'Sony',
          image: 'https://m.media-amazon.com/I/p.jpg',
          primaryImage: 'https://m.media-amazon.com/I/p.jpg',
          merchantUrl: input.merchantUrl,
          price: '205.02',
          currency: 'USD',
          specifications: { Platform: 'PS4' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    const result = await pdpSearchHintsAls.run(
      { brand: 'Sony', name: 'PlayStation VR', category: 'gaming' },
      () =>
        strategy.search('PlayStation VR', {
          seedMerchantUrl: 'https://www.example.com/blog/vr-roundup',
          skipDiscoveryIfSeedStrong: true,
        }),
    );
    assert.ok(discoveryCalls >= 1);
    assert.equal(result.kind, 'Succeeded');
  });

  it('enriches Official + Amazon first and skips BestBuy when merged metadata is ≥90%', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.99,
            },
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
            {
              merchant: 'amazon.in',
              merchantUrl: 'https://www.amazon.in/dp/mac',
              title: 'Apple MacBook Air',
              image: null,
              score: 0.85,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        const isApple = input.merchantUrl.includes('apple.com');
        const isAmazon = /amazon\./i.test(input.merchantUrl);
        return {
          title: 'MacBook Air M4 13-inch laptop',
          brand: 'Apple',
          image: 'https://cdn.example/mac.jpg',
          primaryImage: 'https://cdn.example/mac.jpg',
          description: 'The most capable MacBook Air yet with M4 chip.',
          merchantUrl: input.merchantUrl,
          price: isAmazon ? '99900' : null,
          currency: isAmazon ? 'INR' : null,
          availability: isAmazon ? 'InStock' : null,
          specifications: (isApple ? { Chip: 'M4' } : { Display: '13.6 inch' }) as Record<
            string,
            string
          >,
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
      5,
    );
    const result = await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' },
      () => strategy.search('Apple MacBook Air M4 laptops'),
    );
    assert.equal(result.kind, 'Succeeded');
    assert.deepEqual(
      [...extracted].sort(),
      [
        'https://www.amazon.in/dp/mac',
        'https://www.apple.com/in/macbook-air/',
      ].sort(),
    );
    assert.equal(extracted.includes('https://www.bestbuy.com/site/macbook-air/6509650.p'), false);
    if (result.kind === 'Succeeded') {
      assert.ok(result.candidates.every((c) => c.enrichmentSucceeded === true));
      assert.equal(
        result.candidates.some((c) => c.shoppingEligible === true) ||
          result.candidates.some((c) => c.shoppingEligible === false),
        true,
      );
    }
  });

  it('falls back to remaining shortlist merchants when Official + Amazon stay below 90%', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
            {
              merchant: 'amazon.in',
              merchantUrl: 'https://www.amazon.in/dp/mac',
              title: 'Apple MacBook Air',
              image: null,
              score: 0.85,
            },
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.7,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'Mac',
          brand: 'Apple',
          merchantUrl: input.merchantUrl,
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
      5,
    );
    await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' },
      () => strategy.search('Apple MacBook Air M4 laptops'),
    );
    const preferred = extracted.slice(0, 2);
    assert.ok(preferred.includes('https://www.apple.com/in/macbook-air/'));
    assert.ok(preferred.includes('https://www.amazon.in/dp/mac'));
    assert.ok(extracted.includes('https://www.bestbuy.com/site/macbook-air/6509650.p'));
  });

  it('continues with Amazon then fallback when Official is missing', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'amazon.com',
              merchantUrl: 'https://www.amazon.com/dp/B0MAC',
              title: 'MacBook Air',
              image: null,
              score: 0.9,
            },
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'Mac',
          brand: 'Apple',
          merchantUrl: input.merchantUrl,
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air', category: 'laptops' },
      () => strategy.search('MacBook Air'),
    );
    assert.equal(extracted[0], 'https://www.amazon.com/dp/B0MAC');
    assert.ok(extracted.includes('https://www.bestbuy.com/site/macbook-air/6509650.p'));
  });

  it('stops metadata enrichment at ≥90% without waiting for additional commerce merchants', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
            {
              merchant: 'amazon.in',
              merchantUrl: 'https://www.amazon.in/dp/mac',
              title: 'Apple MacBook Air',
              image: null,
              score: 0.85,
            },
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.7,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'MacBook Air M4 13-inch laptop',
          brand: 'Apple',
          image: 'https://cdn.example/mac.jpg',
          primaryImage: 'https://cdn.example/mac.jpg',
          description: 'The most capable MacBook Air yet with M4 chip.',
          merchantUrl: input.merchantUrl,
          price: '99900',
          currency: 'INR',
          availability: 'InStock',
          specifications: { Chip: 'M4' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    const result = await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' },
      () => strategy.search('MacBook Air'),
    );
    assert.equal(extracted.includes('https://www.bestbuy.com/site/macbook-air/6509650.p'), false);
    if (result.kind === 'Succeeded') {
      assert.equal(extracted.length, 2);
    }
  });

  it('still attempts Amazon preferred discovery when Amazon is absent from the Serper shortlist', async () => {
    const queries: string[] = [];
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(q: string): Promise<SearchResult> {
        queries.push(q);
        if (q.includes('site:amazon.com')) {
          return {
            kind: 'Succeeded',
            provider: 'serper',
            candidates: [
              {
                merchant: 'amazon.com',
                merchantUrl: 'https://www.amazon.com/dp/B0HIDDEN',
                title: 'MacBook Air',
                image: null,
                score: 0.9,
              },
            ],
          };
        }
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.99,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'MacBook Air M4 13-inch laptop',
          brand: 'Apple',
          image: 'https://cdn.example/mac.jpg',
          primaryImage: 'https://cdn.example/mac.jpg',
          description: 'The most capable MacBook Air yet with M4 chip.',
          merchantUrl: input.merchantUrl,
          price: '99900',
          currency: 'INR',
          availability: 'InStock',
          specifications: { Chip: 'M4' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' },
      () => strategy.search('MacBook Air M4'),
    );
    assert.ok(queries.some((q) => q.includes('site:amazon.com')));
    assert.ok(extracted.includes('https://www.amazon.com/dp/B0HIDDEN'));
    assert.ok(extracted.includes('https://www.apple.com/in/macbook-air/'));
    assert.equal(extracted.includes('https://www.bestbuy.com/site/macbook-air/6509650.p'), false);
  });

  it('enriches one canonical Official PDP when several regional Official URLs are discovered', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.5,
            },
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/uk/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.55,
            },
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/us/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.95,
            },
            {
              merchant: 'amazon.com',
              merchantUrl: 'https://www.amazon.com/dp/B0MAC',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'MacBook Air M4 13-inch laptop',
          brand: 'Apple',
          image: 'https://cdn.example/mac.jpg',
          primaryImage: 'https://cdn.example/mac.jpg',
          description: 'The most capable MacBook Air yet with M4 chip.',
          merchantUrl: input.merchantUrl,
          price: '99900',
          currency: 'INR',
          availability: 'InStock',
          specifications: { Chip: 'M4' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air M4', category: 'laptops' },
      () => strategy.search('MacBook Air'),
    );
    const appleExtracted = extracted.filter((url) => url.includes('apple.com'));
    assert.equal(appleExtracted.length, 1);
    assert.equal(extracted.filter((url) => url.includes('amazon.com')).length, 1);
  });

  it('uses existing fallback when Official and Amazon preferred discovery both fail', async () => {
    const queries: string[] = [];
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(q: string): Promise<SearchResult> {
        queries.push(q);
        if (q.includes('official') || q.includes('site:amazon.com')) {
          return { kind: 'Succeeded', provider: 'serper', candidates: [] };
        }
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.9,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'Mac',
          brand: 'Apple',
          merchantUrl: input.merchantUrl,
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air', category: 'laptops' },
      () => strategy.search('MacBook Air'),
    );
    assert.ok(queries.some((q) => q.includes('official')));
    assert.ok(queries.some((q) => q.includes('site:amazon.com')));
    assert.deepEqual(extracted, ['https://www.bestbuy.com/site/macbook-air/6509650.p']);
  });

  it('continues with Official then fallback when Amazon preferred discovery is empty', async () => {
    const discovery: ProductSearchProvider = {
      name: 'serper',
      async search(q: string): Promise<SearchResult> {
        if (q.includes('site:amazon.com')) {
          return { kind: 'Succeeded', provider: 'serper', candidates: [] };
        }
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            {
              merchant: 'apple.com',
              merchantUrl: 'https://www.apple.com/in/macbook-air/',
              title: 'MacBook Air',
              image: null,
              score: 0.8,
            },
            {
              merchant: 'bestbuy.com',
              merchantUrl: 'https://www.bestbuy.com/site/macbook-air/6509650.p',
              title: 'MacBook Air',
              image: null,
              score: 0.7,
            },
          ],
        };
      },
    };
    const extracted: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extracted.push(input.merchantUrl);
        return {
          title: 'Mac',
          brand: 'Apple',
          merchantUrl: input.merchantUrl,
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        };
      },
    };
    const strategy = new TavilyEnrichedPdpSearchStrategy(
      discovery,
      new MerchantEnrichmentService(extractor),
      'ingest-1',
      'trace-1',
    );
    await pdpSearchHintsAls.run(
      { brand: 'Apple', name: 'MacBook Air', category: 'laptops' },
      () => strategy.search('MacBook Air'),
    );
    assert.equal(extracted[0], 'https://www.apple.com/in/macbook-air/');
    assert.ok(extracted.includes('https://www.bestbuy.com/site/macbook-air/6509650.p'));
  });
});

