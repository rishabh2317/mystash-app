import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, beforeEach } from 'node:test';

import type { CollectionViewModel } from '@/src/types/collection';
import type { SearchResultCard } from '@/src/services/searchApi';
import {
  beginSearchReelSession,
  collectionIdsFromSearchResults,
  collectionRefsFromSearchResults,
  initialSearchReelIndex,
  searchReelPath,
  SEARCH_REEL_VIEW_SURFACE,
  shouldOpenSearchReelFeed,
} from './searchReelNavigation';
import { clearSearchReelSession, getSearchReelSession } from '@/src/state/searchReelSession';

const ROOT = join(import.meta.dirname, '..', '..');

function collection(id: string): CollectionViewModel {
  return {
    collectionId: id,
    slug: id,
    title: id,
    heroThumbnailUrl: null,
    productCount: 1,
    publishedAt: null,
    creator: {
      id: 'creator-1',
      username: 'ada',
      displayName: 'Ada',
      avatarUrl: null,
    },
    counters: { views: 0, saves: 0 },
  };
}

beforeEach(() => {
  clearSearchReelSession();
});

describe('searchReelNavigation', () => {
  it('builds the search-scoped reel route', () => {
    assert.equal(searchReelPath('col/1'), '/reel/search/col%2F1');
  });

  it('opens search reel only for typed search collection hits', () => {
    const collections = [collection('a'), collection('b'), collection('c')];
    assert.equal(
      shouldOpenSearchReelFeed({
        hasActiveQuery: true,
        collections,
        tappedCollectionId: 'c',
      }),
      true,
    );
    assert.equal(
      shouldOpenSearchReelFeed({
        hasActiveQuery: false,
        collections,
        tappedCollectionId: 'c',
      }),
      false,
    );
    assert.equal(
      shouldOpenSearchReelFeed({
        hasActiveQuery: true,
        collections,
        tappedCollectionId: 'z',
      }),
      false,
    );
  });

  it('begins session with search ranking order and tapped index', () => {
    const collections = [collection('a'), collection('b'), collection('c')];
    beginSearchReelSession({
      query: 'linen',
      collections,
      startCollectionId: 'c',
      nextCursor: 'next-1',
    });

    const session = getSearchReelSession();
    assert.ok(session);
    assert.deepEqual(session.collections.map((c) => c.collectionId), ['a', 'b', 'c']);
    assert.equal(initialSearchReelIndex(session, 'c'), 2);
    assert.equal(session.nextCursor, 'next-1');
  });

  it('preserves search result order when extracting collection refs', () => {
    const results: SearchResultCard[] = [
      {
        entityType: 'product',
        id: 'p1',
        score: 1,
        title: 'P',
        subtitle: null,
        imageRef: null,
        primaryMediaRef: null,
      },
      {
        entityType: 'collection',
        id: 'b',
        score: 2,
        title: 'B',
        subtitle: null,
        imageRef: null,
        primaryMediaRef: 'thumb-b',
      },
      {
        entityType: 'collection',
        id: 'a',
        score: 3,
        title: 'A',
        subtitle: null,
        imageRef: null,
        primaryMediaRef: null,
      },
      {
        entityType: 'creator',
        id: 'cr',
        score: 4,
        title: 'C',
        subtitle: null,
        imageRef: null,
        primaryMediaRef: null,
      },
    ];

    assert.deepEqual(collectionIdsFromSearchResults(results, []), ['b', 'a']);
    const refs = collectionRefsFromSearchResults(results, []);
    assert.deepEqual(
      refs.map((r) => r.collectionId),
      ['b', 'a'],
    );
    assert.equal(refs[0]?.heroThumbnailUrl, 'thumb-b');
  });

  it('search reel host passes isActive only to the active row', () => {
    const src = readFileSync(join(ROOT, 'app/reel/search/[collectionId].tsx'), 'utf8');
    assert.match(src, /const active = index === activeIndex/);
    assert.match(src, /isActive=\{active\}/);
    assert.match(src, /surface: SEARCH_REEL_VIEW_SURFACE/);
    assert.equal(SEARCH_REEL_VIEW_SURFACE, 'search_reel');
  });

  it('home feed host is unchanged and separate from search reel', () => {
    const home = readFileSync(join(ROOT, 'app/(tabs)/index.tsx'), 'utf8');
    const searchReel = readFileSync(join(ROOT, 'app/reel/search/[collectionId].tsx'), 'utf8');
    assert.doesNotMatch(home, /searchReelSession|beginSearchReelSession|searchReelPath/);
    assert.match(searchReel, /getSearchReelSession/);
    assert.doesNotMatch(searchReel, /useHomeFeed|globalFeed/);
  });

  it('search screen opens search-scoped reel for typed collection taps', () => {
    const search = readFileSync(join(ROOT, 'app/(tabs)/search.tsx'), 'utf8');
    assert.match(search, /shouldOpenSearchReelFeed/);
    assert.match(search, /beginSearchReelSession/);
    assert.match(search, /searchReelPath\(/);
    assert.match(
      search,
      /onCollectionPress[\s\S]*?shouldOpenSearchReelFeed[\s\S]*?searchReelPath/,
    );
  });
});
