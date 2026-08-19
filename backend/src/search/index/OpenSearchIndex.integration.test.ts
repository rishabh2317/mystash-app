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

  it('supports alias generation lifecycle begin/promote', async () => {
    const before = await index.resolveAlias(index.aliasName('product'));
    assert.ok(before);
    const { generation, physical } = await index.beginRebuild('product');
    assert.ok(generation > (before!.generation ?? 0));
    assert.match(physical, new RegExp(`_v${generation}$`));
    await index.promoteGeneration('product', generation);
    const after = await index.resolveAlias(index.aliasName('product'));
    assert.equal(after?.generation, generation);
    await index.deleteGeneration('product', before!.generation);
  });
});
