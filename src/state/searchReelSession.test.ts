import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  appendSearchReelCollections,
  clearSearchReelSession,
  getSearchReelSession,
  initialSearchReelIndex,
  setSearchReelSession,
  updateSearchReelCursor,
} from './searchReelSession';

beforeEach(() => {
  clearSearchReelSession();
});

describe('searchReelSession', () => {
  it('stores collection order and start id', () => {
    setSearchReelSession({
      query: 'linen shirts',
      collections: [
        { collectionId: 'a', heroThumbnailUrl: null },
        { collectionId: 'b', heroThumbnailUrl: 'https://img/b.jpg' },
        { collectionId: 'c', heroThumbnailUrl: null },
      ],
      startCollectionId: 'c',
      nextCursor: 'cursor-1',
    });

    const session = getSearchReelSession();
    assert.ok(session);
    assert.equal(session.query, 'linen shirts');
    assert.deepEqual(session.collections.map((c) => c.collectionId), ['a', 'b', 'c']);
    assert.equal(session.startCollectionId, 'c');
    assert.equal(session.nextCursor, 'cursor-1');
    assert.equal(initialSearchReelIndex(session, 'c'), 2);
  });

  it('appends paginated collections without reordering or duplicating', () => {
    setSearchReelSession({
      query: 'bags',
      collections: [
        { collectionId: 'a', heroThumbnailUrl: null },
        { collectionId: 'b', heroThumbnailUrl: null },
      ],
      startCollectionId: 'a',
      nextCursor: 'c1',
    });

    appendSearchReelCollections([
      { collectionId: 'b', heroThumbnailUrl: null },
      { collectionId: 'c', heroThumbnailUrl: null },
      { collectionId: 'd', heroThumbnailUrl: null },
    ]);

    const session = getSearchReelSession();
    assert.ok(session);
    assert.deepEqual(session.collections.map((c) => c.collectionId), ['a', 'b', 'c', 'd']);
  });

  it('updates pagination cursor', () => {
    setSearchReelSession({
      query: 'shoes',
      collections: [{ collectionId: 'x', heroThumbnailUrl: null }],
      startCollectionId: 'x',
      nextCursor: 'old',
    });

    updateSearchReelCursor('new');
    assert.equal(getSearchReelSession()?.nextCursor, 'new');
  });
});
