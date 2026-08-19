import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isPublishSurfaceTag,
  mapAggregateToCollectionDetail,
  mapPrimaryMedia,
} from './collectionDetailMapper';
import type { CollectionAggregateDto } from '@/src/types/collectionAggregate';

const baseAggregate: CollectionAggregateDto = {
  collection: {
    id: 'col-1',
    slug: 'my-slug',
    title: 'Summer picks',
    caption: 'Curated reel',
    creatorId: 'creator-1',
    creatorName: 'Alex',
    creatorUsername: 'alex',
    creatorAvatar: null,
    heroThumbnailUrl: 'https://example.com/thumb.jpg',
    qualityScore: 4.7,
    publishedAt: '2026-01-01T00:00:00Z',
    originPlatform: 'youtube',
    viewsCount: 10,
    savesCount: 2,
  },
  media: [
    {
      id: 'm1',
      isPrimary: true,
      sourceUrl: 'https://youtube.com/shorts/abc12345678',
      embedUrl: 'https://www.youtube.com/embed/abc12345678',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      title: 'Short title',
      sourceProvider: 'youtube',
    },
  ],
  tags: [
    {
      id: 'tag-2',
      collectionId: 'col-1',
      catalogProductId: 'cat-2',
      sortOrder: 2,
      tagStatus: 'accepted',
      visibility: 'visible',
      includeInPublish: true,
      deletedAt: null,
      nameSnapshot: 'Second',
      imageSnapshot: null,
      brandSnapshot: null,
      categorySnapshot: null,
      resolutionStatus: null,
      merchantUrl: null,
    },
    {
      id: 'tag-1',
      collectionId: 'col-1',
      catalogProductId: 'cat-1',
      sortOrder: 1,
      tagStatus: 'accepted',
      visibility: 'visible',
      includeInPublish: true,
      deletedAt: null,
      nameSnapshot: 'First',
      imageSnapshot: null,
      brandSnapshot: 'Brand',
      categorySnapshot: null,
      resolutionStatus: 'verified',
      merchantUrl: null,
    },
    {
      id: 'tag-hidden',
      collectionId: 'col-1',
      catalogProductId: 'cat-x',
      sortOrder: 0,
      tagStatus: 'rejected',
      visibility: 'visible',
      includeInPublish: true,
      deletedAt: null,
      nameSnapshot: 'Hidden',
      imageSnapshot: null,
      brandSnapshot: null,
      categorySnapshot: null,
      resolutionStatus: null,
      merchantUrl: null,
    },
  ],
};

describe('collectionDetailMapper', () => {
  it('isPublishSurfaceTag excludes rejected tags', () => {
    assert.equal(isPublishSurfaceTag(baseAggregate.tags[0]!), true);
    assert.equal(isPublishSurfaceTag(baseAggregate.tags[2]!), false);
  });

  it('mapPrimaryMedia resolves youtube platform', () => {
    const media = mapPrimaryMedia(baseAggregate);
    assert.equal(media?.platform, 'youtube');
    assert.equal(media?.embedUrl, 'https://www.youtube.com/embed/abc12345678');
  });

  it('mapAggregateToCollectionDetail orders publish-surface tags', () => {
    const detail = mapAggregateToCollectionDetail(baseAggregate, new Map());
    assert.equal(detail.collectionId, 'col-1');
    assert.equal(detail.products.length, 2);
    assert.equal(detail.products[0]!.title, 'First');
    assert.equal(detail.products[1]!.title, 'Second');
    assert.equal(detail.creator.username, 'alex');
  });
});
