import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalEmbeddingProvider } from './embeddings/LocalEmbeddingProvider';
import { InMemorySearchIndex } from './index/InMemorySearchIndex';
import { SearchService } from './SearchService';
import { SearchTelemetryStore } from './telemetry';

describe('SearchService V1', () => {
  async function seeded() {
    const index = new InMemorySearchIndex();
    const embeddings = new LocalEmbeddingProvider(64);
    const telemetry = new SearchTelemetryStore();
    const svc = new SearchService(index, embeddings, telemetry);

    await svc.indexCollection({
      collectionId: 'col-beach',
      slug: 'beach-outfits',
      searchTitle: 'Beach outfits for summer',
      searchText: 'linen looks vacation packing list',
      searchKeywords: ['beach', 'outfits', 'summer'],
      searchBrands: [],
      searchCategories: ['fashion'],
      searchEligible: true,
      contentRevision: 1,
      creator: {
        creatorId: 'creator-1',
        displayName: 'Tech Hints',
        username: 'techhints',
        avatarRef: null,
      },
      primaryMediaRef: 'media-1',
      productTagCount: 3,
      publishedAt: new Date().toISOString(),
      qualityScore: 0.8,
      viewsCount: 100,
      savesCount: 20,
      sharesCount: 2,
      productClicksCount: 5,
      creatorAuthority: 40,
    });

    await svc.indexCollection({
      collectionId: 'col-gadgets',
      slug: 'travel-gadgets',
      searchTitle: 'Best travel gadgets',
      searchText: 'packing tech for ladakh trips',
      searchKeywords: ['travel', 'gadgets'],
      searchEligible: true,
      contentRevision: 1,
      creator: {
        creatorId: 'creator-2',
        displayName: 'Pack Pro',
        username: 'packpro',
        avatarRef: null,
      },
      primaryMediaRef: 'media-2',
      productTagCount: 5,
      publishedAt: new Date().toISOString(),
      qualityScore: 0.7,
      viewsCount: 50,
      savesCount: 10,
    });

    await svc.indexCreator({
      userId: 'creator-1',
      username: 'techhints',
      displayName: 'Tech Hints',
      bio: 'tech reviews',
      followersCount: 1000,
      creatorAuthority: 50,
    });

    await svc.indexProduct({
      catalogProductId: 'prod-xm5',
      name: 'Sony WH-1000XM5',
      brand: 'Sony',
      model: 'XM5',
      aliases: ['sony xm5'],
      verificationStatus: 'verified',
      popularity: 80,
    });

    await svc.indexProduct({
      catalogProductId: 'prod-nike',
      name: 'Nike Pegasus',
      brand: 'Nike',
      category: 'shoes',
      popularity: 40,
    });

    return { svc, index, telemetry };
  }

  it('returns blended collection + creator + product results', async () => {
    const { svc } = await seeded();
    const res = await svc.search({ q: 'sony xm5', presentation: 'unified' });
    assert.equal(res.intent, 'EXACT_PRODUCT');
    assert.ok(res.results.some((r) => r.entityType === 'product'));
    assert.ok(res.lanes);
    assert.ok(res.lanes!.products.length >= 1);
    assert.equal(res.retrievalMode, 'hybrid');
  });

  it('favors collections for discovery queries', async () => {
    const { svc } = await seeded();
    const res = await svc.search({ q: 'beach outfits', presentation: 'typed' });
    assert.equal(res.intent, 'DISCOVERY');
    assert.ok(res.results.some((r) => r.id === 'col-beach'));
    assert.ok(res.lanes!.collections.length >= 1);
  });

  it('supports lexical-only degraded mode', async () => {
    const { svc } = await seeded();
    const res = await svc.search({ q: 'travel gadgets', lexicalOnly: true });
    assert.equal(res.retrievalMode, 'lexical_only');
    assert.ok(res.results.some((r) => r.id === 'col-gadgets'));
  });

  it('removes ineligible collections from serving', async () => {
    const { svc } = await seeded();
    await svc.indexCollection({
      collectionId: 'col-beach',
      slug: 'beach-outfits',
      searchTitle: 'Beach outfits for summer',
      searchText: 'linen',
      searchEligible: false,
      contentRevision: 2,
      creator: {
        creatorId: 'creator-1',
        displayName: 'Tech Hints',
        username: 'techhints',
        avatarRef: null,
      },
    });
    const res = await svc.search({ q: 'beach outfits' });
    assert.ok(!res.results.some((r) => r.id === 'col-beach'));
  });

  it('autocomplete returns entity suggestions', async () => {
    const { svc } = await seeded();
    const ac = await svc.autocomplete({ q: 'sony' });
    assert.ok(ac.suggestions.some((s) => s.kind === 'product' || s.text.toLowerCase().includes('sony')));
  });

  it('records search telemetry separately from engagement', async () => {
    const { svc, telemetry } = await seeded();
    await svc.search({ q: 'nike', userId: 'u1' });
    svc.recordClick({
      query: 'nike',
      userId: 'u1',
      clickedId: 'prod-nike',
      clickedEntityType: 'product',
    });
    const events = telemetry.all();
    assert.ok(events.some((e) => e.eventType === 'query'));
    assert.ok(events.some((e) => e.eventType === 'click'));
    assert.deepEqual(telemetry.recentSearches('u1'), ['nike']);
  });

  it('exposes one-way candidates for recommendations', async () => {
    const { svc } = await seeded();
    const cands = await svc.candidatesForRecommendations({ q: 'travel gadgets', limit: 10 });
    assert.ok(cands.length >= 1);
    assert.ok(cands[0]!.id);
  });

  it('refreshes creator snapshots on collections asynchronously', async () => {
    const { svc, index } = await seeded();
    await svc.refreshCreatorSnapshotOnCollections({
      creatorId: 'creator-1',
      displayName: 'Tech Hints Updated',
      username: 'techhints',
      avatarRef: 'avatar-new',
      collectionIds: ['col-beach'],
    });
    const doc = await index.get('collection', 'col-beach');
    assert.ok(doc && doc.entityType === 'collection');
    assert.equal(doc.creator.displayName, 'Tech Hints Updated');
  });

  it('applies nearline engagement mirrors without requiring re-embed success path', async () => {
    const { svc, index } = await seeded();
    await svc.applyCollectionEngagementMirrors('col-beach', {
      viewsCount: 999,
      savesCount: 50,
    });
    const doc = await index.get('collection', 'col-beach');
    assert.ok(doc && doc.entityType === 'collection');
    assert.equal(doc.viewsCount, 999);
    assert.equal(doc.savesCount, 50);
  });

  it('paginates with nextCursor without duplicates', async () => {
    const index = new InMemorySearchIndex();
    const embeddings = new LocalEmbeddingProvider(64);
    const svc = new SearchService(index, embeddings);
    for (let i = 0; i < 12; i++) {
      await svc.indexCollection({
        collectionId: `col-page-${i}`,
        slug: `slug-${i}`,
        searchTitle: `Beach outfits page ${i}`,
        searchText: 'beach outfits linen summer',
        searchEligible: true,
        contentRevision: 1,
        creator: {
          creatorId: `c-${i % 4}`,
          displayName: `Creator ${i}`,
          username: `user${i}`,
          avatarRef: null,
        },
        publishedAt: new Date(Date.now() - i * 1000).toISOString(),
        savesCount: 100 - i,
        viewsCount: 200 - i,
      });
    }
    const page1 = await svc.search({ q: 'beach outfits', limit: 5 });
    assert.equal(page1.results.length, 5);
    assert.ok(page1.nextCursor);
    const page2 = await svc.search({
      q: 'beach outfits',
      limit: 5,
      cursor: page1.nextCursor,
    });
    assert.ok(page2.results.length >= 1);
    const ids1 = new Set(page1.results.map((r) => r.id));
    for (const r of page2.results) {
      assert.equal(ids1.has(r.id), false, `duplicate ${r.id}`);
    }
    // stable: same first page again
    const page1b = await svc.search({ q: 'beach outfits', limit: 5 });
    assert.deepEqual(
      page1b.results.map((r) => r.id),
      page1.results.map((r) => r.id),
    );
    // end of results eventually
    let cursor: string | null = page2.nextCursor;
    let guard = 0;
    while (cursor && guard < 10) {
      const p = await svc.search({ q: 'beach outfits', limit: 5, cursor });
      cursor = p.nextCursor;
      guard++;
    }
    assert.equal(cursor, null);
  });

  it('rejects incompatible embedding space on upsert', async () => {
    const index = new InMemorySearchIndex({
      embeddingSpace: {
        embeddingModelId: 'local-feature-hash',
        embeddingVersion: 'v1',
        embeddingDimension: 64,
      },
    });
    const { EmbeddingSpaceMismatchError } = await import('./index/OpenSearchIndex');
    await assert.rejects(
      () =>
        index.upsert({
          id: 'x',
          entityType: 'product',
          catalogProductId: 'x',
          canonicalSlug: null,
          name: 'X',
          brand: null,
          model: null,
          category: null,
          aliases: [],
          verificationStatus: null,
          primaryImageRef: null,
          searchableText: 'x',
          searchEligible: true,
          contentRevision: 1,
          indexedAt: new Date().toISOString(),
          popularity: 0,
          lastVerifiedAt: null,
          priceAmount: null,
          priceCurrency: null,
          embedding: [1, 0, 0],
          embeddingModelId: 'other-model',
          embeddingVersion: 'v9',
          embeddingDimension: 3,
        }),
      EmbeddingSpaceMismatchError,
    );
  });
});
