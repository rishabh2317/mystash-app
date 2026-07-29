import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectMerchantLabel } from './merchantDetect';
import {
  computeMetadataCompleteness,
  MerchantMetadataNormalizer,
} from './MerchantMetadataNormalizer';
import { MerchantEnrichmentService } from './MerchantEnrichmentService';
import { MerchantMetadataValidator } from './MerchantMetadataValidator';
import type { MerchantExtractor } from './MerchantExtractor';
import type { MerchantProductMetadata } from './types';

describe('detectMerchantLabel', () => {
  it('maps known hosts to display names', () => {
    assert.equal(detectMerchantLabel('https://www.apple.com/macbook'), 'Apple');
    assert.equal(detectMerchantLabel('https://www.amazon.in/dp/x'), 'Amazon');
    assert.equal(detectMerchantLabel('https://www.flipkart.com/p/x'), 'Flipkart');
  });
});

describe('computeMetadataCompleteness', () => {
  it('scores 100 when all fields present', () => {
    assert.equal(
      computeMetadataCompleteness({
        title: 'MacBook Air',
        brand: 'Apple',
        image: 'https://img.example/a.jpg',
        description: 'A long enough product description for scoring.',
        merchant: 'Apple',
        price: 'USD 999',
        currency: 'USD',
        availability: 'In stock',
        specifications: { Color: 'Midnight' },
      }),
      100,
    );
  });

  it('does not count merchant as product metadata', () => {
    assert.equal(
      computeMetadataCompleteness({
        title: 'MacBook',
        merchant: 'Apple',
      }),
      25,
    );
  });
});

describe('MerchantMetadataNormalizer', () => {
  it('normalizes brand Inc suffix and builds short description', () => {
    const n = new MerchantMetadataNormalizer();
    const out = n.normalize({
      title: 'macbook air m4',
      brand: 'Apple Inc.',
      description: '<p>Great laptop</p>  with   lots   of space. '.repeat(20),
      merchantUrl: 'https://www.apple.com/mac',
      provider: 'tavily',
      specifications: { Color: 'Midnight', Storage: '512GB' },
      price: '₹1,00,000',
      currency: 'INR',
    });
    assert.equal(out.brand, 'Apple');
    assert.equal(out.merchant, 'Apple');
    assert.ok(out.shortDescription);
    assert.ok((out.shortDescription?.length ?? 0) <= 170);
    assert.equal(out.specifications.Color, 'Midnight');
    assert.ok(out.metadataCompleteness >= 70);
  });
});

describe('MerchantMetadataValidator', () => {
  it('allows missing price', () => {
    const v = new MerchantMetadataValidator();
    const r = v.validate({
      title: 'Bike',
      brand: null,
      image: null,
      primaryImage: null,
      description: null,
      shortDescription: null,
      merchant: 'Shop',
      merchantUrl: 'https://shop.example/p/1',
      category: null,
      price: null,
      currency: null,
      availability: null,
      specifications: {},
      priceSource: null,
      priceLastVerifiedAt: null,
      extractedAt: new Date().toISOString(),
      provider: 'tavily',
      metadataCompleteness: 30,
    });
    assert.equal(r.ok, true);
  });
});

describe('MerchantEnrichmentService', () => {
  it('normalizes extractor output and logs completion path', async () => {
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract() {
        return {
          title: 'Road Bike',
          brand: 'Giant Inc.',
          image: 'https://cdn.example/bike.jpg',
          primaryImage: 'https://cdn.example/bike.jpg',
          description: 'A capable carbon road bicycle for daily training rides.',
          merchantUrl: 'https://www.amazon.in/dp/bike',
          price: '49999',
          currency: 'INR',
          specifications: { Frame: 'Carbon' },
          provider: 'mock',
          extractedAt: new Date().toISOString(),
        } satisfies Partial<MerchantProductMetadata>;
      },
    };
    const svc = new MerchantEnrichmentService(extractor);
    const r = await svc.enrich({
      merchantUrl: 'https://www.amazon.in/dp/bike',
      ingestId: 'ing',
      traceId: 'tr',
    });
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.metadata.merchant, 'Amazon');
      assert.equal(r.metadata.brand, 'Giant');
      assert.ok(r.metadata.metadataCompleteness >= 80);
      assert.equal(r.metadata.specifications.Frame, 'Carbon');
    }
  });

  it('returns failed when extractor throws', async () => {
    const extractor: MerchantExtractor = {
      name: 'mock',
      async extract() {
        throw new Error('boom');
      },
    };
    const r = await new MerchantEnrichmentService(extractor).enrich({
      merchantUrl: 'https://shop.example/p',
      ingestId: 'i',
      traceId: 't',
    });
    assert.equal(r.kind, 'failed');
  });
});
