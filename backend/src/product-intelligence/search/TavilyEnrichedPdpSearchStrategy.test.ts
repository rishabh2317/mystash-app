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
    assert.ok(extracted.includes('https://www.apple.com/in/macbook-air/'));
    assert.ok(extracted.includes('https://www.amazon.in/dp/mac'));
    assert.ok(maxInFlight >= 2, 'independent enrichments should overlap');
    if (result.kind === 'Succeeded') {
      assert.ok(result.candidates.length >= 2);
      assert.ok(result.candidates.every((c) => c.enrichmentSucceeded === true));
      assert.ok(result.candidates.some((c) => c.sourceTier === 'official'));
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
});
