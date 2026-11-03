import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CollectionAggregateDto } from '@/src/types/collectionAggregate';
import { mapAggregateToCollectionViewModel } from './collectionMapper';

describe('mapAggregateToCollectionViewModel', () => {
  it('counts published tags and keeps existing collection fields', () => {
    const aggregate: CollectionAggregateDto = {
      collection: {
        id: 'col-1',
        slug: 'slug',
        title: 'Desk setup',
        caption: null,
        creatorId: 'c1',
        creatorName: 'Rama',
        creatorUsername: 'rama',
        creatorAvatar: null,
        heroThumbnailUrl: 'https://example.com/t.jpg',
        qualityScore: null,
        publishedAt: '2026-01-01T00:00:00Z',
        originPlatform: 'youtube',
        viewsCount: 12,
        savesCount: 3,
      },
      media: [],
      tags: [
        {
          id: 't1',
          collectionId: 'col-1',
          catalogProductId: 'p1',
          sortOrder: 1,
          tagStatus: 'accepted',
          visibility: 'visible',
          includeInPublish: true,
          deletedAt: null,
          nameSnapshot: 'A',
          imageSnapshot: null,
          brandSnapshot: null,
          categorySnapshot: null,
          resolutionStatus: null,
          merchantUrl: null,
        },
        {
          id: 't2',
          collectionId: 'col-1',
          catalogProductId: 'p2',
          sortOrder: 2,
          tagStatus: 'accepted',
          visibility: 'visible',
          includeInPublish: false,
          deletedAt: null,
          nameSnapshot: 'B',
          imageSnapshot: null,
          brandSnapshot: null,
          categorySnapshot: null,
          resolutionStatus: null,
          merchantUrl: null,
        },
      ],
    };

    const vm = mapAggregateToCollectionViewModel(aggregate);
    assert.equal(vm.collectionId, 'col-1');
    assert.equal(vm.title, 'Desk setup');
    assert.equal(vm.productCount, 1);
    assert.equal(vm.counters.views, 12);
    assert.equal(vm.creator.username, 'rama');
  });
});

it('uses the saved primary media thumbnail when a saved Collection has no hero', () => {
  const aggregate = {
    collection: { id: 'c', creatorId: 'u', heroThumbnailUrl: '   ' },
    media: [{ id: 'secondary', isPrimary: false, thumbnailUrl: 'https://fixture.invalid/other.jpg' },
      { id: 'primary', isPrimary: true, thumbnailUrl: 'https://fixture.invalid/primary.jpg' }], tags: [],
  } as unknown as CollectionAggregateDto;
  assert.equal(mapAggregateToCollectionViewModel(aggregate).heroThumbnailUrl, 'https://fixture.invalid/primary.jpg');
  aggregate.collection.heroThumbnailUrl = 'https://fixture.invalid/hero.jpg';
  assert.equal(mapAggregateToCollectionViewModel(aggregate).heroThumbnailUrl, 'https://fixture.invalid/hero.jpg');
  aggregate.collection.heroThumbnailUrl = null; aggregate.media = [];
  assert.equal(mapAggregateToCollectionViewModel(aggregate).heroThumbnailUrl, null);
});
