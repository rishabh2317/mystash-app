import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CollectionAggregateDto } from '../types/collectionAggregate';
import { mapAggregateToFeedCollectionContext } from './feedCollectionContext';

function stub(overrides?: Partial<CollectionAggregateDto['collection']>): CollectionAggregateDto {
  return {
    collection: {
      id: 'col-1',
      slug: 'col-1',
      title: 'Summer',
      caption: null,
      creatorId: 'user-uuid',
      creatorName: 'Ada',
      creatorUsername: '@ada',
      creatorAvatar: 'https://cdn.example/a.jpg',
      heroThumbnailUrl: null,
      qualityScore: 4.5,
      publishedAt: null,
      originPlatform: 'youtube',
      viewsCount: 9,
      savesCount: 3,
      ...overrides,
    },
    media: [],
    tags: [],
  };
}

describe('mapAggregateToFeedCollectionContext', () => {
  it('maps creator UUID, handle, and avatar without counters for the overlay', () => {
    const ctx = mapAggregateToFeedCollectionContext(stub());
    assert.equal(ctx.collectionId, 'col-1');
    assert.equal(ctx.creator.id, 'user-uuid');
    assert.equal(ctx.creator.username, 'ada');
    assert.equal(ctx.creator.avatarUrl, 'https://cdn.example/a.jpg');
    assert.equal(ctx.title, 'Summer');
  });

  it('keeps a missing public username as null', () => {
    const ctx = mapAggregateToFeedCollectionContext(
      stub({ creatorUsername: null, creatorAvatar: null }),
    );
    assert.equal(ctx.creator.username, null);
    assert.equal(ctx.creator.avatarUrl, null);
  });
});
