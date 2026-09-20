import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MerchantEnrichmentService } from '../../product-intelligence/enrichment/MerchantEnrichmentService';
import type { MerchantExtractor } from '../../product-intelligence/enrichment/MerchantExtractor';
import type { MerchantProductMetadata } from '../../product-intelligence/enrichment/types';
import { SafeHttpError } from '../../pipeline/safeHttp';
import { canonicalizeProductUrl } from '../../pipeline/urlCanonicalization';
import type { ContentSourceRecord } from '../domain/types';
import { ContentSourceTerminalError } from './errors';
import { createWebEnrichmentAdapterFromService } from './webAdapter';

function webSource(url: string): ContentSourceRecord {
  return {
    id: 'src-web-1',
    platform: 'web',
    externalId: 'm_webmug000000000000000000000',
    canonicalUrl: url,
    mediaKind: 'WEB_PAGE',
    processingStatus: 'PROCESSING',
    pipelineVersion: 'test',
    queuedAt: null,
    lastProcessedAt: null,
    candidateCount: 0,
    failureReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function metadata(partial: Partial<MerchantProductMetadata> = {}): MerchantProductMetadata {
  return {
    title: 'Stoneware Mug',
    brand: 'Example',
    image: 'https://cdn.example.com/mug.jpg',
    primaryImage: 'https://cdn.example.com/mug.jpg',
    description: 'A mug',
    shortDescription: null,
    merchant: 'shop.example.com',
    merchantUrl: 'https://shop.example.com/p/mug',
    category: null,
    price: '$24',
    currency: 'USD',
    availability: null,
    specifications: {},
    priceSource: 'merchant',
    priceLastVerifiedAt: null,
    extractedAt: new Date().toISOString(),
    provider: 'tavily',
    metadataCompleteness: 40,
    ...partial,
  };
}

describe('createWebEnrichmentAdapter', () => {
  it('reuses canonicalizeProductUrl and MerchantEnrichmentService', async () => {
    const urls: string[] = [];
    const extractor: MerchantExtractor = {
      name: 'tavily',
      extract: async (input) => {
        urls.push(input.merchantUrl);
        return metadata();
      },
    };
    const adapter = createWebEnrichmentAdapterFromService(new MerchantEnrichmentService(extractor));
    const tracked = 'https://shop.example.com/p/mug?utm_source=ig&fbclid=abc';
    const result = await adapter.enrich({
      contentSource: webSource(tracked),
      traceId: 't1',
    });

    assert.deepEqual(urls, [canonicalizeProductUrl(tracked)]);
    assert.equal(urls[0], 'https://shop.example.com/p/mug');
    assert.equal(result.empty, false);
    assert.equal(result.candidate?.name, 'Stoneware Mug');
    assert.equal(result.candidate?.brand, 'Example');
    assert.equal(result.candidate?.merchantUrl, 'https://shop.example.com/p/mug');
  });

  it('returns an empty success when enrichment cannot produce a product', async () => {
    const extractor: MerchantExtractor = {
      name: 'tavily',
      extract: async () => null,
    };
    const adapter = createWebEnrichmentAdapterFromService(new MerchantEnrichmentService(extractor));
    const result = await adapter.enrich({
      contentSource: webSource('https://shop.example.com/p/mug'),
      traceId: 't1',
    });
    assert.equal(result.empty, true);
    assert.equal(result.candidate, null);
  });

  it('maps a failed enrichment result to an empty success, not a fake candidate', async () => {
    const extractor: MerchantExtractor = {
      name: 'tavily',
      extract: async () => {
        throw new Error('upstream timeout');
      },
    };
    const adapter = createWebEnrichmentAdapterFromService(new MerchantEnrichmentService(extractor));
    // MerchantEnrichmentService swallows extractor exceptions into kind:failed.
    const result = await adapter.enrich({
      contentSource: webSource('https://shop.example.com/p/mug'),
      traceId: 't1',
    });
    assert.equal(result.empty, true);
  });

  it('marks private-destination fetch failures as terminal', async () => {
    const adapter = createWebEnrichmentAdapterFromService({
      enrich: async () => {
        throw new SafeHttpError('That link cannot be fetched', 'PRIVATE_DESTINATION');
      },
    } as unknown as MerchantEnrichmentService);

    await assert.rejects(
      () => adapter.enrich({ contentSource: webSource('https://shop.example.com/p/mug'), traceId: 't1' }),
      (err: unknown) => err instanceof ContentSourceTerminalError && err.code === 'PRIVATE_DESTINATION',
    );
  });
});
