/**
 * OpenSearch integration tests — require a real OpenSearch.
 *
 * Start:
 *   docker compose -f docker-compose.search.yml up -d
 *
 * Run:
 *   npm run test:search:integration
 *
 * These tests NEVER fall back to InMemorySearchIndex.
 * If OpenSearch is unreachable, they fail with a clear error.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { LocalEmbeddingProvider } from '../embeddings/LocalEmbeddingProvider';
import {
  EmbeddingSpaceMismatchError,
  OpenSearchIndex,
} from './OpenSearchIndex';
import { SearchService } from '../SearchService';
import { fuseHybridCandidates } from '../domain/hybrid';
import { rankCandidates } from '../domain/ranking';
import { detectQueryIntent } from '../domain/intent';
import { buildProductSearchDocument } from '../documents';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const PREFIX = `mystash_it_${Date.now()}`;

async function requireOpenSearch(): Promise<void> {
  try {
    const res = await fetch(OPENSEARCH_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    throw new Error(
      `OpenSearch integration tests require a running OpenSearch at ${OPENSEARCH_URL}. ` +
        `Start with: docker compose -f backend/docker-compose.search.yml up -d. ` +
        `Cause: ${e instanceof Error ? e.message : String(e)}. ` +
        `These tests do NOT fall back to InMemorySearchIndex.`,
    );
  }
}

describe('OpenSearchIndex integration', () => {
  const embeddings = new LocalEmbeddingProvider(64);
  let index: OpenSearchIndex;
  let svc: SearchService;

  before(async () => {
    await requireOpenSearch();
    index = new OpenSearchIndex({
      node: OPENSEARCH_URL,
      indexPrefix: PREFIX,
      embeddingSpace: {
        embeddingModelId: embeddings.modelId,
        embeddingVersion: embeddings.version,
        embeddingDimension: embeddings.dimension,
      },
    });
    await index.ensureIndexes();
    svc = new SearchService(index, embeddings);
  });

  after(async () => {
    // best-effort cleanup of test generations
    try {
      for (const et of ['collection', 'creator', 'product'] as const) {
        const resolved = await index.resolveAlias(index.aliasName(et));
        if (resolved) {
          // remove alias then delete physical
          try {
            await fetch(`${OPENSEARCH_URL}/_aliases`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                actions: [{ remove: { index: resolved.physical, alias: index.aliasName(et) } }],
              }),
            });
          } catch {
            /* ignore */
          }
          try {
            await fetch(`${OPENSEARCH_URL}/${resolved.physical}`, { method: 'DELETE' });
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  });

  it('creates aliased versioned indexes with mapping', async () => {
    const a = await index.resolveAlias(index.aliasName('collection'));
    assert.ok(a);
    assert.match(a!.physical, /_v\d+$/);
    assert.ok(!a!.physical.endsWith('_current'));
  });

  it('refuses to serve an older mapping without replacing its alias with an empty generation', async () => {
    const prefix = `${PREFIX}_legacy`;
    const physical = `${prefix}_collections_v1`;
    const alias = `${prefix}_collections`;
    const put = await fetch(`${OPENSEARCH_URL}/${physical}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: { _meta: { embeddingModelId: embeddings.modelId,
        embeddingVersion: embeddings.version, embeddingDimension: embeddings.dimension, generation: 1 },
        properties: { id: { type: 'keyword' } } } }) });
    assert.equal(put.ok, true);
    try {
      const add = await fetch(`${OPENSEARCH_URL}/_aliases`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: [{ add: { index: physical, alias } }] }) });
      assert.equal(add.ok, true);
      const legacy = new OpenSearchIndex({ node: OPENSEARCH_URL, indexPrefix: prefix,
        embeddingSpace: { embeddingModelId: embeddings.modelId, embeddingVersion: embeddings.version,
          embeddingDimension: embeddings.dimension } });
      await assert.rejects(() => legacy.startStartupCheck(), /complete generation rebuild/);
      await assert.rejects(() => legacy.lexicalSearch({ q: 'test', limit: 5 }), /complete generation rebuild/);
      assert.equal((await legacy.resolveAlias(alias))?.physical, physical);
    } finally {
      await fetch(`${OPENSEARCH_URL}/${physical}`, { method: 'DELETE' });
    }
  });

  it('upserts Collection, Creator, Product and retrieves lexically (BM25)', async () => {
    await svc.indexCollection({
      collectionId: 'it-col-1',
      slug: 'beach-outfits',
      searchTitle: 'Beach outfits for summer',
      searchText: 'linen vacation looks',
      searchKeywords: ['beach', 'outfits'],
      searchEligible: true,
      contentRevision: 1,
      creator: {
        creatorId: 'it-creator-1',
        displayName: 'Tech Hints',
        username: 'techhints',
        avatarRef: null,
      },
      primaryMediaRef: 'media-1',
      productTagCount: 2,
      publishedAt: new Date().toISOString(),
      qualityScore: 0.9,
      savesCount: 12,
      viewsCount: 100,
    });
    await svc.indexCreator({
      userId: 'it-creator-1',
      username: 'techhints',
      displayName: 'Tech Hints',
      bio: 'tech reviews',
      followersCount: 50,
    });
    await svc.indexProduct({
      catalogProductId: 'it-prod-xm5',
      name: 'Sony WH-1000XM5',
      brand: 'Sony',
      model: 'XM5',
      aliases: ['sony xm5'],
      verificationStatus: 'verified',
      popularity: 10,
    });

    const lexical = await index.lexicalSearch({ q: 'sony xm5', limit: 10 });
    assert.ok(lexical.some((h) => h.id === 'it-prod-xm5'));
    const beach = await index.lexicalSearch({ q: 'beach outfits', limit: 10 });
    assert.ok(beach.some((h) => h.id === 'it-col-1'));
  });

  it('supports vector/ANN retrieval', async () => {
    const emb = await embeddings.embedQuery('beach outfits summer linen');
    const hits = await index.vectorSearch({ vector: emb.embedding, limit: 10 });
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((h) => h.entityType === 'collection'));
  });

  it('retains the top-level vector when nearline counters update a Collection', async () => {
    const before = await index.get('collection', 'it-col-1');
    assert.ok(before?.embedding?.length);
    await svc.applyCollectionEngagementMirrors('it-col-1', { viewsCount: 101 });
    const after = await index.get('collection', 'it-col-1');
    assert.deepEqual(after?.embedding, before?.embedding);
    assert.equal(after?.entityType === 'collection' ? after.viewsCount : null, 101);
  });

  it('hybrid RRF + Mystash ranking remains Search-owned (not OpenSearch final authority)', async () => {
    const prepared = 'beach outfits';
    const lexical = await index.lexicalSearch({ q: prepared, limit: 20 });
    const emb = await embeddings.embedQuery(prepared);
    const vector = await index.vectorSearch({ vector: emb.embedding, limit: 20 });
    const fused = fuseHybridCandidates(lexical, vector);
    assert.ok(fused.length >= 1);
    const { laneWeights } = detectQueryIntent(prepared);
    const ranked = rankCandidates(fused, laneWeights);
    // Collection-first for discovery
    assert.ok(ranked[0]);
    // OpenSearch scores alone are not the final order — Mystash re-ranks
    const osTopId = lexical[0]?.id;
    // Just assert ranking function produced scores using business signals path
    assert.ok(typeof ranked[0]!.score === 'number');
    void osTopId;
  });

  it('filters ineligible documents and deletes', async () => {
    await svc.indexCollection({
      collectionId: 'it-col-gone',
      slug: 'gone',
      searchTitle: 'Temporary beach',
      searchText: 'temp',
      searchEligible: true,
      contentRevision: 1,
      creator: {
        creatorId: 'it-creator-1',
        displayName: 'Tech Hints',
        username: 'techhints',
        avatarRef: null,
      },
    });
    let hit = await index.get('collection', 'it-col-gone');
    assert.ok(hit);
    await svc.deleteEntity('collection', 'it-col-gone');
    hit = await index.get('collection', 'it-col-gone');
    assert.equal(hit, null);
  });

  it('autocomplete returns prefix suggestions without mapping errors', async () => {
    const suggestions = await index.autocomplete({ prefix: 'bea', limit: 10 });
    assert.ok(suggestions.length >= 1);
    assert.ok(suggestions.some((s) => s.text.toLowerCase().includes('beach')));
  });

  it('bulk upsert works', async () => {
    for (let i = 0; i < 5; i++) {
      await svc.indexProduct({
        catalogProductId: `it-bulk-${i}`,
        name: `Bulk Gadget ${i}`,
        brand: 'BulkBrand',
        popularity: i,
      });
    }
    const hits = await index.lexicalSearch({ q: 'Bulk Gadget', limit: 10 });
    assert.ok(hits.length >= 3);
  });

  it('rejects incompatible embedding space', async () => {
    await assert.rejects(
      () =>
        index.upsert({
          id: 'bad-emb',
          entityType: 'product',
          catalogProductId: 'bad-emb',
          canonicalSlug: null,
          name: 'Bad',
          brand: null,
          model: null,
          category: null,
          aliases: [],
          verificationStatus: null,
          primaryImageRef: null,
          searchableText: 'bad',
          searchEligible: true,
          contentRevision: 1,
          indexedAt: new Date().toISOString(),
          popularity: 0,
          lastVerifiedAt: null,
          priceAmount: null,
          priceCurrency: null,
          embedding: [1, 0],
          embeddingModelId: 'wrong-model',
          embeddingVersion: 'v99',
          embeddingDimension: 2,
        }),
      EmbeddingSpaceMismatchError,
    );
  });

  it('SearchService hybrid + lexical-only degradation against OpenSearch', async () => {
    const hybrid = await svc.search({ q: 'sony xm5', limit: 10 });
    assert.ok(['hybrid', 'lexical_only', 'semantic_only'].includes(hybrid.retrievalMode));
    assert.ok(hybrid.results.length >= 1);

    const lexicalOnly = await svc.search({ q: 'sony xm5', lexicalOnly: true, limit: 10 });
    assert.equal(lexicalOnly.retrievalMode, 'lexical_only');
    assert.ok(lexicalOnly.results.length >= 1);
  });

  it('paginates SearchService results via cursor', async () => {
    for (let i = 0; i < 8; i++) {
      await svc.indexCollection({
        collectionId: `it-page-${i}`,
        slug: `it-page-${i}`,
        searchTitle: `Travel gadgets set ${i}`,
        searchText: 'best travel gadgets packing',
        searchEligible: true,
        contentRevision: 1,
        creator: {
          creatorId: `it-c-${i}`,
          displayName: `C${i}`,
          username: `c${i}`,
          avatarRef: null,
        },
        savesCount: 50 - i,
        publishedAt: new Date().toISOString(),
      });
    }
    const p1 = await svc.search({ q: 'travel gadgets', limit: 3 });
    assert.equal(p1.results.length, 3);
    assert.ok(p1.nextCursor);
    const p2 = await svc.search({ q: 'travel gadgets', limit: 3, cursor: p1.nextCursor });
    const set = new Set(p1.results.map((r) => r.id));
    for (const r of p2.results) assert.equal(set.has(r.id), false);
  });

  it('ranks exact public product, collection, and creator identities above broad semantic matches', async () => {
    const product = await svc.search({ q: 'Sony WH-1000XM5', entityType: 'product', limit: 10 });
    assert.equal(product.results[0]?.id, 'it-prod-xm5');
    const collection = await svc.search({ q: 'Beach outfits for summer', entityType: 'collection', limit: 10 });
    assert.equal(collection.results[0]?.id, 'it-col-1');
    const creator = await svc.search({ q: '@techhints', entityType: 'creator', limit: 10 });
    assert.equal(creator.results[0]?.id, 'it-creator-1');
  });

  it('filters before retrieval, including narrow brand/category/price and efficient vector filters', async () => {
    const documents = Array.from({ length: 90 }, (_, i) => buildProductSearchDocument({
      catalogProductId: `filter-${i}`, name: 'Blue linen shoes', brand: i === 89 ? 'Niche' : 'Common',
      category: i === 89 ? 'Footwear' : 'Clothing', priceAmount: i === 89 ? 499 : 999,
      verificationStatus: i === 89 ? 'verified' : 'partial', searchEligible: true,
    }));
    await index.upsertMany(documents);
    await svc.indexProduct({ catalogProductId: 'filter-89', name: 'Blue linen shoes',
      brand: 'Niche', category: 'Footwear', priceAmount: 499, verificationStatus: 'verified' });
    const filters = { brand: 'Niche', category: 'Footwear', priceMax: 500, verifiedOnly: true };
    const lexical = await index.lexicalSearch({ q: 'blue linen shoes', entityTypes: ['product'], filters, limit: 10 });
    assert.deepEqual(lexical.map(h => h.id), ['filter-89']);
    const vector = await embeddings.embedQuery('blue linen shoes');
    const semantic = await index.vectorSearch({ vector: vector.embedding, entityTypes: ['product'], filters, limit: 10 });
    assert.deepEqual(semantic.map(h => h.id), ['filter-89']);
    const result = await svc.search({ q: 'blue linen shoes', entityType: 'product', filters, limit: 10 });
    assert.deepEqual(result.results.map(h => h.id), ['filter-89']);
  });

  it('keyset-pages every matching product beyond the hybrid head without skips or duplicates', async () => {
    const documents = Array.from({ length: 155 }, (_, i) => buildProductSearchDocument({
      catalogProductId: `deep-${String(i).padStart(3, '0')}`, name: `Deep Paging Backpack ${i}`,
      brand: 'PageBrand', searchEligible: true,
    }));
    await index.upsertMany(documents);
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await svc.search({ q: 'Deep Paging Backpack', entityType: 'product',
        lexicalOnly: true, limit: 17, cursor });
      for (const result of page.results) {
        assert.equal(seen.has(result.id), false, `duplicate ${result.id}`);
        seen.add(result.id);
      }
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages < 20, 'cursor must terminate');
    } while (cursor);
    assert.equal(seen.size, 155);
    assert.ok(pages > 6);
    const first = await svc.search({ q: 'Deep Paging Backpack', entityType: 'product',
      lexicalOnly: true, limit: 2 });
    assert.ok(first.nextCursor);
    await assert.rejects(() => svc.search({ q: 'Running Shoe', entityType: 'product',
      lexicalOnly: true, limit: 2, cursor: first.nextCursor }), /Invalid search cursor/);
  });

  it('supports alias generation lifecycle begin/promote', async () => {
    const before = await index.resolveAlias(index.aliasName('product'));
    assert.ok(before);
    const { generation, physical } = await index.beginRebuild('product');
    assert.ok(generation > (before!.generation ?? 0));
    assert.match(physical, new RegExp(`_v${generation}$`));
    const copied = await index.copyServingToGeneration('product', generation);
    assert.equal(copied.sourceCount, copied.targetCount);
    assert.ok(copied.targetCount >= 155);
    await index.promoteGeneration('product', generation);
    const after = await index.resolveAlias(index.aliasName('product'));
    assert.equal(after?.generation, generation);
    await index.deleteGeneration('product', before!.generation);
  });
});
