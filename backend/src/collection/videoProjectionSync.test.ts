import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Collection } from './domain/types';
import {
  buildFeedVideoWrite,
  feedShelfDrafts,
  pruneVideoProjectionIfNotPublic,
  syncHomeFeedProjection,
  type FeedShelfTag,
} from './videoProjectionSync';

function baseCollection(): Collection {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    slug: 'c',
    creatorId: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'published',
    visibility: 'public',
    publishedAt: new Date().toISOString(),
    unpublishedAt: null,
    archivedAt: null,
    deletedAt: null,
    contentRevision: 1,
    title: null,
    caption: null,
    language: null,
    primaryLocale: null,
    recommendationIntent: null,
    recommendationIntentsSecondary: [],
    recommendationIntentSource: null,
    recommendationIntentConfidence: null,
    creatorName: null,
    creatorUsername: null,
    creatorAvatar: null,
    creatorVerified: false,
    creatorSnapshotUpdatedAt: null,
    primaryMediaId: null,
    mediaCount: 0,
    heroThumbnailUrl: null,
    primaryProductTagId: null,
    productTagCount: 0,
    primaryProductNameSnapshot: null,
    searchTitle: null,
    searchText: null,
    searchKeywords: [],
    searchBrands: [],
    searchCategories: [],
    searchSourceUpdatedAt: null,
    viewsCount: 0,
    likesCount: 0,
    savesCount: 0,
    sharesCount: 0,
    productClicksCount: 0,
    purchasesCount: 0,
    countersUpdatedAt: null,
    qualityScore: null,
    commerceScore: null,
    searchScore: null,
    recommendationScore: null,
    trustScore: null,
    qualitySignalsUpdatedAt: null,
    feedEligible: true,
    searchEligible: true,
    recsEligible: true,
    moderationState: 'clear',
    moderationNotesRef: null,
    originType: 'url_ingest',
    originPlatform: null,
    originSourceUrl: null,
    latestIngestRunId: null,
    schemaVersion: 1,
    extensions: {},
  };
}

function buildAdminSpy() {
  const calls: Array<{ table: string; id: string }> = [];
  return {
    admin: {
      from(table: string) {
        return {
          delete() {
            return {
              async eq(_column: string, id: string) {
                calls.push({ table, id });
                return { error: null };
              },
            };
          },
        };
      },
    } as unknown as { from: (table: string) => { delete: () => { eq: (_c: string, id: string) => Promise<{ error: null }> } } },
    calls,
  };
}

describe('video projection lifecycle pruning', () => {
  it('keeps video when collection remains publicly readable', async () => {
    const { admin, calls } = buildAdminSpy();
    await pruneVideoProjectionIfNotPublic(admin as never, baseCollection());
    assert.equal(calls.length, 0);
  });

  it('prunes video when collection is unpublished/private/moderated/deleted', async () => {
    const variants: Collection[] = [
      { ...baseCollection(), status: 'unpublished' },
      { ...baseCollection(), visibility: 'private' },
      { ...baseCollection(), moderationState: 'needs_review' },
      { ...baseCollection(), deletedAt: new Date().toISOString() },
    ];
    for (const variant of variants) {
      const { admin, calls } = buildAdminSpy();
      await pruneVideoProjectionIfNotPublic(admin as never, variant);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.table, 'videos');
      assert.equal(calls[0]?.id, variant.id);
    }
  });
});

function shelfTag(overrides: Partial<FeedShelfTag> = {}): FeedShelfTag {
  return {
    catalogProductId: 'cat-1',
    includeInPublish: true,
    deletedAt: null,
    tagStatus: 'accepted',
    visibility: 'visible',
    resolutionStatus: 'UNVERIFIED',
    nameSnapshot: 'Lamp',
    imageSnapshot: 'https://cdn.example/lamp.jpg',
    merchantUrl: 'https://shop.example/lamp',
    brandSnapshot: 'Shop',
    sortOrder: 0,
    ...overrides,
  };
}

describe('feed video projection write', () => {
  it('builds a YouTube embed row from collection media without a provider fetch', () => {
    const row = buildFeedVideoWrite(
      {
        ...baseCollection(),
        title: 'Desk tour',
        creatorUsername: 'ada',
        primaryProductNameSnapshot: 'Lamp',
        heroThumbnailUrl: 'https://cdn.example/hero.jpg',
        originPlatform: 'youtube',
      },
      {
        canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        sourceUrl: null,
        embedUrl: null,
        thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
        title: 'Desk tour',
      },
    );
    assert.ok(row);
    assert.equal(row?.collection_id, baseCollection().id);
    assert.equal(row?.thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    assert.match(row?.embed_url ?? '', /^https:\/\/www\.youtube\.com\/embed\/abcdefghijk/);
    assert.equal(row?.creator_name, 'ada');
    assert.equal(row?.product_name, 'Lamp');
  });

  it('keeps Instagram on the embed URL', () => {
    const row = buildFeedVideoWrite(
      { ...baseCollection(), originPlatform: 'instagram', title: 'Reel' },
      {
        canonicalUrl: 'https://www.instagram.com/reel/ABC123xyz/',
        sourceUrl: null,
        embedUrl: null,
        thumbnailUrl: 'https://cdn.example/ig.jpg',
        title: 'Reel',
      },
    );
    assert.match(row?.embed_url ?? '', /instagram\.com\/p\/.+\/embed/);
    assert.equal(row?.embed_url?.includes('media_url'), false);
  });

  it('does not project a collection that is not public', () => {
    assert.equal(
      buildFeedVideoWrite(
        { ...baseCollection(), visibility: 'private', originSourceUrl: 'https://youtu.be/abcdefghijk' },
        null,
      ),
      null,
    );
  });

  it('copies only catalog publish-surface tags onto the shelf', () => {
    const drafts = feedShelfDrafts([
      shelfTag(),
      shelfTag({ catalogProductId: null, nameSnapshot: 'Discovered' }),
      shelfTag({ catalogProductId: 'cat-2', includeInPublish: false, sortOrder: 1 }),
      shelfTag({ catalogProductId: 'cat-3', resolutionStatus: 'UNRESOLVED', sortOrder: 2 }),
    ]);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.catalog_product_id, 'cat-1');
  });
});

describe('syncHomeFeedProjection', () => {
  it('inserts one videos row for a published library collection and does not duplicate on retry', async () => {
    const collection = {
      ...baseCollection(),
      title: 'Synced',
      creatorUsername: 'ada',
      originPlatform: 'youtube' as const,
      primaryProductNameSnapshot: 'Lamp',
    };
    const state: {
      video: { id: string } | null;
      products: { id: string }[];
      inserts: Array<{ table: string; row: unknown }>;
      updates: unknown[];
      deletes: string[];
    } = { video: null, products: [], inserts: [], updates: [], deletes: [] };

    function admin() {
      return {
        from(table: string) {
          const filters: Record<string, unknown> = {};
          let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
          let payload: unknown;
          const builder = {
            select() {
              return builder;
            },
            insert(row: unknown) {
              op = 'insert';
              payload = row;
              state.inserts.push({ table, row });
              if (table === 'videos' && row && typeof row === 'object' && 'id' in row) {
                state.video = { id: String((row as { id: string }).id) };
              }
              if (table === 'video_products') state.products = [{ id: 'vp' }];
              return builder;
            },
            update(row: unknown) {
              op = 'update';
              payload = row;
              state.updates.push(row);
              return builder;
            },
            delete() {
              op = 'delete';
              return builder;
            },
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            order() {
              return builder;
            },
            limit() {
              return builder;
            },
            maybeSingle() {
              return Promise.resolve(read());
            },
            then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
              return Promise.resolve(read()).then(onFulfilled, onRejected);
            },
          };

          function read() {
            if (op === 'delete') {
              state.deletes.push(String(filters.collection_id ?? ''));
              return { data: null, error: null };
            }
            if (op === 'insert' || op === 'update') return { data: null, error: null, payload };
            if (table === 'collection_media') {
              return {
                data: [
                  {
                    canonical_url: 'https://www.youtube.com/watch?v=abcdefghijk',
                    source_url: null,
                    embed_url: null,
                    thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
                    title: 'Synced',
                  },
                ],
                error: null,
              };
            }
            if (table === 'videos') return { data: state.video, error: null };
            if (table === 'video_products') return { data: state.products, error: null };
            if (table === 'collection_product_tags') {
              return {
                data: [
                  {
                    catalog_product_id: 'cat-1',
                    include_in_publish: true,
                    deleted_at: null,
                    tag_status: 'accepted',
                    visibility: 'visible',
                    resolution_status: 'UNVERIFIED',
                    name_snapshot: 'Lamp',
                    image_snapshot: 'https://cdn.example/lamp.jpg',
                    merchant_url: null,
                    brand_snapshot: 'Shop',
                    sort_order: 0,
                  },
                ],
                error: null,
              };
            }
            return { data: null, error: null };
          }

          return builder;
        },
      };
    }

    const first = await syncHomeFeedProjection(admin() as never, collection);
    assert.equal(first, 'upserted');
    assert.equal(state.inserts.filter((row) => row.table === 'videos').length, 1);
    assert.equal(state.inserts.filter((row) => row.table === 'video_products').length, 1);

    const second = await syncHomeFeedProjection(admin() as never, collection);
    assert.equal(second, 'upserted');
    assert.equal(state.inserts.filter((row) => row.table === 'videos').length, 1);
    assert.equal(state.updates.length, 1);
    assert.equal(state.inserts.filter((row) => row.table === 'video_products').length, 1);
  });
});

