import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchResult } from '../domain/types';
import { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import type { MerchantExtractor } from '../enrichment/MerchantExtractor';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import { pdpSearchHintsAls } from './pdpSearchHints';
import { TavilyEnrichedPdpSearchStrategy } from './TavilyEnrichedPdpSearchStrategy';

describe('TavilyEnrichedPdpSearchStrategy integration', () => {
  it('ranks Serper URLs then enriches only the best PDP', async () => {
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

    let extractedUrl: string | null = null;
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract(input) {
        extractedUrl = input.merchantUrl;
        return {
          title: 'MacBook Air M4 13-inch',
          brand: 'Apple',
          image: 'https://store.apple.com/hero.jpg',
          primaryImage: 'https://store.apple.com/hero.jpg',
          description: 'The most capable MacBook Air yet with M4.',
          merchantUrl: input.merchantUrl,
          price: '99900',
          currency: 'INR',
          specifications: { Chip: 'M4', Display: '13.6 inch' },
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
      () => strategy.search('Apple MacBook Air M4 laptops'),
    );

    assert.equal(result.kind, 'Succeeded');
    assert.equal(extractedUrl, 'https://www.apple.com/in/macbook-air/');
    if (result.kind === 'Succeeded') {
      assert.equal(result.candidates.length, 1);
      const c = result.candidates[0]!;
      assert.equal(c.title, 'MacBook Air M4 13-inch');
      assert.equal(c.image, 'https://store.apple.com/hero.jpg');
      assert.equal(c.merchant, 'Apple');
      assert.equal(c.sourceTier, 'official');
      assert.equal(c.enrichmentMeta?.metadata_completeness, 100);
      assert.deepEqual(c.enrichmentMeta?.specifications, {
        Chip: 'M4',
        Display: '13.6 inch',
      });
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
      assert.equal(result.candidates[0]?.merchantUrl, 'https://shop.example/products/nike-air-max-95');
      assert.equal(result.candidates[0]?.enrichmentSucceeded, true);
      assert.equal(result.candidates[0]?.pdpVerdict, 'pdp');
    }
  });
});
