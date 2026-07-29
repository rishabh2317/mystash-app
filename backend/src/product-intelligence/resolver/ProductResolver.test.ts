import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogRepository, DraftUpdater, MatchHistoryWriter } from '../interfaces/CatalogRepository';
import type { SearchStrategy } from '../interfaces/ProductSearchProvider';
import type { CatalogProduct, CreateCatalogInput, SearchResult } from '../domain/types';
import { getProductIntelligenceConfig } from '../config';
import { ProductResolver } from './ProductResolver';
import type { BackgroundResolveEnqueuer } from './ProductResolver';

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

function mockRepo(store: { created: CreateCatalogInput[] }): CatalogRepository {
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
    async findByMerchantUrl() {
      return null;
    },
    async findBySlug() {
      return null;
    },
    async findById() {
      return null;
    },
    async create(input) {
      store.created.push(input);
      return catalogStub({
        id: `c-${store.created.length}`,
        name: input.name,
        verificationStatus: input.verificationStatus,
        merchantUrl: input.merchantUrl ?? null,
      });
    },
    async update(id, patch) {
      const prev = store.created[store.created.length - 1];
      return catalogStub({
        id,
        name: patch.name ?? prev?.name ?? 'updated',
        verificationStatus: patch.verificationStatus ?? prev?.verificationStatus ?? 'VERIFIED',
        merchantUrl: patch.merchantUrl ?? prev?.merchantUrl ?? null,
        affiliateUrl: patch.affiliateUrl ?? null,
      });
    },
    async addAlias() {},
    async listActiveForFuzzy() {
      return [];
    },
  };
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
              pdpScore: 0.8,
              pdpVerdict: 'pdp',
              pdpReasons: ['product_url_pattern', 'merchant_product_metadata'],
              enrichmentSucceeded: true,
              enrichmentMeta: { enrichmentProvider: 'mock', metadata_completeness: 70 },
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
      mockRepo(store),
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
      },
    ]);
    assert.equal(r[0]!.resolutionStatus, 'VERIFIED');
    assert.ok(r[0]!.catalogProductId);
    assert.equal(store.created[0]!.verificationStatus, 'VERIFIED');
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
      mockRepo(store),
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
      mockRepo(store),
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
      mockRepo(store),
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
          }],
        };
      },
    };
    const resolver = new ProductResolver(
      mockRepo(store),
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
  });
});
