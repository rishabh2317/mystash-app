import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Collection } from './domain/types';
import { pruneVideoProjectionIfNotPublic } from './videoProjectionSync';

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

