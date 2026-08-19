import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogRepository, DraftUpdater, MatchHistoryWriter } from '../interfaces/CatalogRepository';
import type { SearchStrategy } from '../interfaces/ProductSearchProvider';
import type { CatalogProduct, CreateCatalogInput, SearchResult } from '../domain/types';
import { getProductIntelligenceConfig } from '../config';
import { ProductResolver } from './ProductResolver';
import type { BackgroundResolveEnqueuer } from './ProductResolver';
import { CatalogService } from '../../catalog/CatalogService';

function catalogStub(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'cat-1',
    canonicalSlug: 'road-bicycle',
    brand: null,
    name: 'Road Bicycle',
    normalizedName: 'road bicycle',
    model: null,
    category: 'sports',
    description: null,
    imageUrl: null,
    merchant: 'shop.example',
    merchantUrl: 'https://shop.example/p/bike',
    preferredShoppingUrl: 'https://shop.example/p/bike',
    affiliateUrl: null,
    shoppingProvider: 'merchant',
    currency: null,
    price: null,
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    verificationProvider: 'google_cse',
    verificationSource: 'google_cse',
    verificationVersion: 'v1',
    lastVerifiedAt: new Date().toISOString(),
    aiConfidence: 0.9,
    matchConfidence: 0.8,
    verificationConfidence: 0.9,
    mergedIntoId: null,
    metadata: {},
    ...overrides,
  };
}

function mockRepo(store: {
  created: CreateCatalogInput[];
  existing?: CatalogProduct | null;
  updates?: Array<Record<string, unknown>>;
}): CatalogRepository {
  return {
    async findByNormalizedName() {
      return [];
    },
    async findByAlias() {
      return [];
    },
    async findByBrandModel() {
      return [];
    },
    async findByMerchantUrl(url) {
      if (store.existing?.merchantUrl === url) return store.existing;
      return null;
    },
    async findBySlug() {
      return null;
    },
    async findById(id) {
      if (store.existing?.id === id) return store.existing;
      return null;
    },
    async create(input) {
      store.created.push(input);
      return catalogStub({
        id: `c-${store.created.length}`,
        name: input.name,
        verificationStatus: input.verificationStatus,
        merchantUrl: input.merchantUrl ?? null,
        price: input.price ?? null,
        currency: input.currency ?? null,
      });
    },
    async update(id, patch) {
      store.updates?.push(patch as Record<string, unknown>);
      const prev = store.existing ?? store.created[store.created.length - 1];
      return catalogStub({
        id,
        name: patch.name ?? prev?.name ?? 'updated',
        verificationStatus: patch.verificationStatus ?? prev?.verificationStatus ?? 'VERIFIED',
        merchantUrl: patch.merchantUrl ?? prev?.merchantUrl ?? null,
        affiliateUrl: patch.affiliateUrl ?? null,
        price: (patch.price as string | null | undefined) ?? prev?.price ?? null,
        currency: (patch.currency as string | null | undefined) ?? prev?.currency ?? null,
      });
    },
    async addAlias() {},
    async listActiveForFuzzy() {
      return [];
    },
  };
}

function catalogService(store: {
  created: CreateCatalogInput[];
  existing?: CatalogProduct | null;
  updates?: Array<Record<string, unknown>>;
}): CatalogService {
  return new CatalogService(mockRepo(store));
}

describe('ProductResolver', () => {
  it('creates VERIFIED when search returns PDP', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'mock',
          candidates: [
            {
              merchant: 'shop.example',
              merchantUrl: 'https://shop.example/p/bike',
              title: 'Nike Air Max 95',
              image: null,
              score: 0.9,
              brand: 'Nike',
              price: 'USD 100',
              currency: null,
              pdpScore: 0.8,
              pdpVerdict: 'pdp',
              pdpReasons: ['product_url_pattern', 'merchant_product_metadata'],
              enrichmentSucceeded: true,
              sourceType: 'RETAILER',
              pageType: 'PRODUCT',
              capabilities: {
                metadata: true,
                commerce: true,
                specifications: true,
                images: true,
                evidence: true,
              },
              enrichmentMeta: {
                enrichmentProvider: 'mock',
                metadata_completeness: 70,
                availability: 'InStock',
              },
            },
          ],
        };
      },
    };
    const updates: unknown[] = [];
    const drafts: DraftUpdater = {
      async updateResolution(u) {
        updates.push(u);
      },
    };
    const history: MatchHistoryWriter = { async write() {} };
    const bg: BackgroundResolveEnqueuer = { async enqueue() {} };
    const cfg = { ...getProductIntelligenceConfig(), enabled: true };

    const resolver = new ProductResolver(
      catalogService(store),
      search,
      drafts,
      history,
      cfg,
      bg,
      'ingest-1',
    );
    const r = await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'Nike Air Max 95',
        brand: 'Nike',
        model: 'Air Max 95',
        confidence: 0.9,
        category: 'sports',
        price: '200',
        currency: 'EUR',
      },
    ]);
    assert.equal(r[0]!.resolutionStatus, 'VERIFIED');
    assert.ok(r[0]!.catalogProductId);
    assert.equal(store.created[0]!.verificationStatus, 'VERIFIED');
    assert.equal(store.created[0]!.price, 'USD 100');
    assert.equal(store.created[0]!.currency, null);
    assert.equal(store.created[0]!.merchant, 'shop.example');
    assert.equal(store.created[0]!.merchantUrl, 'https://shop.example/p/bike');
    assert.equal(
      (store.created[0]!.metadata?.scores as Record<string, unknown>)?.specificity != null,
      true,
    );
    assert.equal(
      (store.created[0]!.metadata?.verification as Record<string, unknown>)?.decision,
      'created_verified',
    );
  });

  it('creates UNVERIFIED when search succeeds empty', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        return { kind: 'Succeeded', provider: 'mock', candidates: [] };
      },
    };
    const drafts: DraftUpdater = { async updateResolution() {} };
    const history: MatchHistoryWriter = { async write() {} };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      drafts,
      history,
      getProductIntelligenceConfig(),
      null,
      'ingest-1',
    );
    const r = await resolver.resolveIngest([
      { draftId: 'd1', externalId: 'e1', name: 'Mystery Gadget', confidence: 0.7 },
    ]);
    assert.equal(r[0]!.resolutionStatus, 'UNVERIFIED');
    assert.equal(store.created[0]!.verificationStatus, 'UNVERIFIED');
  });

  it('creates UNRESOLVED catalog row when search fails (UI SoT)', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const enqueued: unknown[] = [];
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        return { kind: 'Failed', errorKind: 'quota', message: '429', provider: 'mock' };
      },
    };
    const drafts: DraftUpdater = { async updateResolution() {} };
    const history: MatchHistoryWriter = { async write() {} };
    const bg: BackgroundResolveEnqueuer = {
      async enqueue(j) {
        enqueued.push(j);
      },
    };
    const cfg = { ...getProductIntelligenceConfig(), backgroundResolve: true };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      drafts,
      history,
      cfg,
      bg,
      'ingest-1',
    );
    const r = await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'Sony WH-1000XM6',
        brand: 'Sony',
        model: 'WH-1000XM6',
        confidence: 0.8,
      },
    ]);
    assert.equal(r[0]!.resolutionStatus, 'UNRESOLVED');
    assert.ok(r[0]!.catalogProductId);
    assert.equal(store.created.length, 1);
    assert.equal(store.created[0]!.verificationStatus, 'UNRESOLVED');
    assert.equal(enqueued.length, 1);
  });

  it('keeps generic categories UNVERIFIED without calling search', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    let searched = false;
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        searched = true;
        return { kind: 'Succeeded', provider: 'mock', candidates: [] };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      getProductIntelligenceConfig(),
      null,
      'ingest',
    );
    const [result] = await resolver.resolveIngest([
      { draftId: 'd', externalId: 'e', name: 'Running Shoes', confidence: 0.99 },
    ]);
    assert.equal(searched, false);
    assert.equal(result?.resolutionStatus, 'UNVERIFIED');
    assert.equal(result?.decision, 'insufficient_specificity');
  });

  it('never marks editorial review metadata VERIFIED', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [{
            merchant: 'Believe in the Run',
            merchantUrl: 'https://believeintherun.com/adidas-hyperboost-edge-review',
            title: 'Adidas Hyperboost Edge Running Shoes',
            brand: 'Adidas',
            image: 'https://believeintherun.com/shoe.jpg',
            price: '120',
            score: 0.95,
            pdpScore: 0.8,
            pdpVerdict: 'pdp',
            sourceTier: 'editorial',
            enrichmentSucceeded: true,
            sourceType: 'REVIEW',
            pageType: 'REVIEW',
            capabilities: {
              metadata: false,
              commerce: false,
              specifications: true,
              images: true,
              evidence: true,
            },
          }],
        };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      getProductIntelligenceConfig(),
      null,
      'ingest',
    );
    const [result] = await resolver.resolveIngest([{
      draftId: 'd',
      externalId: 'e',
      name: 'Adidas Hyperboost Edge KI4392',
      brand: 'Adidas',
      model: 'KI4392',
      confidence: 0.9,
    }]);
    assert.equal(result?.resolutionStatus, 'UNVERIFIED');
    assert.equal(store.created[0]?.verificationStatus, 'UNVERIFIED');
    assert.equal(
      (store.created[0]?.metadata?.verification as Record<string, unknown>)?.decision,
      'created_metadata_only',
    );
  });

  it('does not verify iPhone 16e-style weak match merely because an offer exists', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'mock',
          candidates: [
            {
              merchant: 'Apple',
              merchantUrl: 'https://www.apple.com/iphone/',
              // Intentionally weak overlap vs draft "Apple iPhone 16e"
              title: 'iPhone - Apple',
              brand: 'Apple',
              image: null,
              score: 1,
              price: '599',
              pdpScore: 0.47,
              pdpVerdict: 'pdp',
              enrichmentSucceeded: true,
              sourceType: 'OFFICIAL',
              pageType: 'PRODUCT',
              capabilities: {
                metadata: true,
                commerce: true,
                specifications: false,
                images: true,
                evidence: true,
              },
              enrichmentMeta: { availability: 'InStock' },
            },
          ],
        };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      getProductIntelligenceConfig(),
      null,
      'ingest',
    );
    const [result] = await resolver.resolveIngest([
      {
        draftId: 'd-16e',
        externalId: 'e-16e',
        name: 'Apple iPhone 16e',
        brand: 'Apple',
        model: '16e',
        confidence: 0.9,
        category: 'electronics',
      },
    ]);
    assert.equal(result?.resolutionStatus, 'UNVERIFIED');
    assert.equal(store.created[0]?.verificationStatus, 'UNVERIFIED');
    assert.equal(
      (store.created[0]?.metadata?.verification as Record<string, unknown>)?.decision,
      'created_unverified_weak_identity',
    );
    const scores = store.created[0]?.metadata?.scores as Record<string, number>;
    assert.ok((scores?.match ?? 1) < 0.85);
  });

  it('does not keep a stale currency when a new price is written', async () => {
    const store = {
      created: [] as CreateCatalogInput[],
      updates: [] as Array<Record<string, unknown>>,
      existing: catalogStub({
        id: 'existing-1',
        name: 'Galaxy S26 Ultra',
        brand: 'Samsung',
        normalizedName: 'galaxy s26 ultra',
        price: '₹1,137.00',
        currency: 'INR',
        verificationStatus: 'UNVERIFIED',
      }),
    };
    const search: SearchStrategy = {
      async search(): Promise<SearchResult> {
        return {
          kind: 'Succeeded',
          provider: 'mock',
          candidates: [
            {
              merchant: 'amazon.com',
              merchantUrl:
                'https://www.amazon.com/Samsung-Unlocked-Smartphone-Charging-Warranty/dp/B0G4SW3XXP',
              title: 'Samsung Galaxy S26 Ultra',
              image: null,
              score: 0.9,
              brand: 'Samsung',
              price: '$1,137.00',
              currency: null,
              pdpScore: 0.9,
              pdpVerdict: 'pdp',
              pdpReasons: ['product_url_pattern', 'merchant_product_metadata'],
              enrichmentSucceeded: true,
              sourceType: 'MARKETPLACE',
              pageType: 'PRODUCT',
              capabilities: {
                metadata: true,
                commerce: true,
                specifications: true,
                images: true,
                evidence: true,
              },
              enrichmentMeta: {
                enrichmentProvider: 'mock',
                metadata_completeness: 80,
              },
            },
          ],
        };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      { ...getProductIntelligenceConfig(), enabled: true },
      { async enqueue() {} },
      'ingest-currency',
    );

    await resolver.resolveIngest([
      {
        draftId: 'd-currency',
        externalId: 'e-currency',
        name: 'Galaxy S26 Ultra',
        brand: 'Samsung',
        confidence: 0.95,
        catalogProductId: 'existing-1',
      },
    ]);

    const patch = store.updates[0];
    assert.equal(patch?.price, '$1,137.00');
    assert.equal(patch?.currency, null);
  });

  function commercePdp(overrides: Partial<import('../domain/types').SearchCandidate> = {}) {
    return {
      merchant: 'shop.example',
      merchantUrl: 'https://www.amazon.com/dp/B0747YTV7B',
      title: 'Sony PlayStation VR Camera Bundle',
      image: 'https://img.example/p.jpg',
      score: 0.9,
      brand: 'Sony',
      price: '205.02',
      currency: 'USD',
      pdpScore: 0.79,
      pdpVerdict: 'pdp' as const,
      enrichmentSucceeded: true,
      sourceType: 'MARKETPLACE' as const,
      pageType: 'PRODUCT' as const,
      capabilities: {
        metadata: true,
        commerce: true,
        specifications: true,
        images: true,
        evidence: true,
      },
      ...overrides,
    };
  }

  it('passes seed URL hints for creator-supplied manual identity', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    let seen: { seed?: string; skip?: boolean } | undefined;
    const creatorUrl = 'https://www.amazon.com/dp/B0747YTV7B';
    let persistedProvider: string | undefined | null = 'unset';
    const search: SearchStrategy = {
      async search(_q, hints) {
        seen = { seed: hints?.seedMerchantUrl, skip: hints?.skipDiscoveryIfSeedStrong };
        return {
          kind: 'Succeeded',
          provider: 'direct_url',
          candidates: [commercePdp({ merchantUrl: creatorUrl, title: 'PlayStation VR Bundle' })],
        };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      {
        async updateResolution(update) {
          persistedProvider = update.displayProvider;
        },
      },
      { async write() {} },
      { ...getProductIntelligenceConfig(), enabled: true },
      null,
      'ingest-manual',
    );
    const [result] = await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'PlayStation VR Bundle',
        brand: 'Sony',
        confidence: 0.95,
        merchantUrl: creatorUrl,
        creatorSuppliedUrl: true,
      },
    ]);
    assert.equal(seen?.seed, creatorUrl);
    assert.equal(seen?.skip, true);
    assert.equal(store.created[0]?.merchantUrl, creatorUrl);
    assert.equal(result?.resolutionStatus, 'VERIFIED');
    assert.equal(persistedProvider, undefined);
  });

  it('does not pass seed hints for video-ingest drafts', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    let hintsPassed = false;
    const search: SearchStrategy = {
      async search(_q, hints) {
        hintsPassed = hints != null;
        return { kind: 'Succeeded', provider: 'serper', candidates: [commercePdp()] };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      { ...getProductIntelligenceConfig(), enabled: true },
      null,
      'ingest-yt',
    );
    await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'PlayStation VR Bundle',
        brand: 'Sony',
        confidence: 0.95,
        merchantUrl: 'https://www.playstation.com/en-us/ps-vr/',
      },
    ]);
    assert.equal(hintsPassed, false);
  });

  it('keeps creator-supplied URL as catalog source when a marketplace candidate scores higher', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const creatorUrl = 'https://www.playstation.com/en-us/ps-vr/';
    const amazonUrl = 'https://www.amazon.com/dp/B0747YTV7B';
    const search: SearchStrategy = {
      async search() {
        return {
          kind: 'Succeeded',
          provider: 'serper',
          candidates: [
            commercePdp({
              merchant: 'amazon.com',
              merchantUrl: amazonUrl,
              title: 'Sony PlayStation VR Camera Bundle for PS4',
              score: 1,
            }),
            commercePdp({
              merchant: 'playstation.com',
              merchantUrl: creatorUrl,
              title: 'PlayStation VR',
              score: 0.4,
              pdpScore: 0.53,
              sourceType: 'RETAILER',
            }),
          ],
        };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      { ...getProductIntelligenceConfig(), enabled: true },
      null,
      'ingest-manual',
    );
    await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'PlayStation VR',
        brand: 'Sony',
        confidence: 0.9,
        merchantUrl: creatorUrl,
        creatorSuppliedUrl: true,
      },
    ]);
    assert.equal(store.created[0]?.merchantUrl, creatorUrl);
    assert.equal(store.created[0]?.preferredShoppingUrl, amazonUrl);
  });

  it('reuses a VERIFIED catalog product by merchant URL without searching', async () => {
    const existing = catalogStub({
      id: 'cat-reuse',
      name: 'PlayStation VR Bundle',
      merchantUrl: 'https://www.amazon.com/dp/B0747YTV7B',
      verificationStatus: 'VERIFIED',
    });
    const store = { created: [] as CreateCatalogInput[], existing };
    let searched = false;
    const search: SearchStrategy = {
      async search() {
        searched = true;
        return { kind: 'Succeeded', provider: 'serper', candidates: [] };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      { ...getProductIntelligenceConfig(), enabled: true },
      null,
      'ingest-manual',
    );
    const [result] = await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'PlayStation VR Bundle',
        brand: 'Sony',
        confidence: 0.95,
        merchantUrl: existing.merchantUrl,
        creatorSuppliedUrl: true,
      },
    ]);
    assert.equal(searched, false);
    assert.equal(result?.catalogProductId, 'cat-reuse');
    assert.equal(result?.decision, 'local_hit');
    assert.equal(store.created.length, 0);
  });

  it('does not stay metadata-only for a creator-supplied Amazon short URL', async () => {
    const store = { created: [] as CreateCatalogInput[] };
    const creatorUrl = 'https://amzn.in/d/01fhRXW8';
    const search: SearchStrategy = {
      async search() {
        return {
          kind: 'Succeeded',
          provider: 'direct_url',
          candidates: [
            commercePdp({
              merchant: 'amzn.in',
              merchantUrl: creatorUrl,
              title: 'Xbox Series S 1TB',
              brand: 'Microsoft',
              sourceType: 'MARKETPLACE',
              pageType: 'PRODUCT',
              pdpScore: 0.73,
              pdpVerdict: 'pdp',
              description: 'All-digital next-gen gaming console with 1TB storage.',
              enrichmentMeta: {
                enrichmentProvider: 'tavily',
                specifications: { Storage: '1TB' },
                metadata_completeness: 95,
                short_description: 'Xbox Series S 1TB',
              },
            }),
          ],
        };
      },
    };
    const resolver = new ProductResolver(
      catalogService(store),
      search,
      { async updateResolution() {} },
      { async write() {} },
      { ...getProductIntelligenceConfig(), enabled: true },
      null,
      'ingest-manual',
    );
    const [result] = await resolver.resolveIngest([
      {
        draftId: 'd1',
        externalId: 'e1',
        name: 'Microsoft Xbox Series S 1tb All-digital',
        brand: 'Microsoft',
        confidence: 0.95,
        merchantUrl: creatorUrl,
        creatorSuppliedUrl: true,
      },
    ]);
    assert.notEqual(result?.decision, 'created_metadata_only');
    assert.equal(store.created[0]?.merchantUrl, creatorUrl);
    assert.notEqual(store.created[0]?.verificationStatus, 'UNRESOLVED');
    const verification = store.created[0]?.metadata?.verification as
      | { decision?: string }
      | undefined;
    assert.notEqual(verification?.decision, 'created_metadata_only');
  });
});
