import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CREATOR_MORE_COLLECTIONS_PREVIEW,
  filterCreatorCollectionsPreview,
  shouldShowCreatorCollectionsViewAll,
} from '@/src/ui/collectionCreatorMore';
import type { CollectionViewModel } from '@/src/types/collection';

function row(id: string): CollectionViewModel {
  return {
    collectionId: id,
    slug: id,
    title: id,
    heroThumbnailUrl: null,
    productCount: 1,
    publishedAt: null,
    creator: {
      id: 'creator-1',
      username: 'alex',
      displayName: 'Alex',
      avatarUrl: null,
    },
    counters: { views: 0, saves: 0 },
  };
}

describe('collectionCreatorMore', () => {
  it('filters out the current collection and limits preview tiles', () => {
    const preview = filterCreatorCollectionsPreview(
      [row('current'), row('b'), row('c'), row('d')],
      'current',
      2,
    );
    assert.deepEqual(preview.map((c) => c.collectionId), ['b', 'c']);
    assert.equal(CREATOR_MORE_COLLECTIONS_PREVIEW, 6);
  });

  it('shows View all when more collections exist or pagination remains', () => {
    assert.equal(
      shouldShowCreatorCollectionsViewAll({
        totalOthers: 7,
        previewLimit: 6,
        hasNextCursor: false,
        creatorUsername: 'alex',
      }),
      true,
    );
    assert.equal(
      shouldShowCreatorCollectionsViewAll({
        totalOthers: 2,
        previewLimit: 6,
        hasNextCursor: true,
        creatorUsername: 'alex',
      }),
      true,
    );
    assert.equal(
      shouldShowCreatorCollectionsViewAll({
        totalOthers: 2,
        previewLimit: 6,
        hasNextCursor: false,
        creatorUsername: null,
      }),
      false,
    );
  });
});
