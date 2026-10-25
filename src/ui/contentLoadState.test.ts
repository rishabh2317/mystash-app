import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasDetailContent,
  hasListContent,
  resolveContentLoadState,
  resolveListLoadState,
  resourceIdentity,
  retainLoadedContent,
} from './contentLoadState';

describe('content load state', () => {
  it('uses item counts for lists and a readiness flag for detail screens', () => {
    assert.equal(hasListContent(0), false);
    assert.equal(hasListContent(3), true);
    assert.equal(hasDetailContent(false), false);
    assert.equal(hasDetailContent(true), true);

    assert.equal(resolveListLoadState({ itemCount: 0, fetching: true }), 'skeleton');
    assert.equal(
      resolveContentLoadState({ hasContent: hasDetailContent(false), fetching: true }),
      'skeleton',
    );
    assert.equal(
      resolveContentLoadState({ hasContent: hasDetailContent(true), fetching: false }),
      'content',
    );
  });

  it('shows skeleton on initial fetch, then content, empty, or error', () => {
    assert.equal(resolveContentLoadState({ hasContent: false, fetching: true }), 'skeleton');
    assert.equal(resolveContentLoadState({ hasContent: true, fetching: false }), 'content');
    assert.equal(resolveContentLoadState({ hasContent: false, fetching: false }), 'empty');
    assert.equal(
      resolveContentLoadState({ hasContent: false, fetching: false, error: true }),
      'error',
    );
  });

  it('never leaves skeleton up after a failed request with no content', () => {
    assert.equal(
      resolveContentLoadState({ hasContent: false, fetching: false, error: true }),
      'error',
    );
    assert.notEqual(
      resolveContentLoadState({ hasContent: false, fetching: false, error: true }),
      'skeleton',
    );
  });

  it('keeps loaded content during refresh and prefers fetchingMore for pagination', () => {
    assert.equal(
      resolveContentLoadState({ hasContent: true, fetching: true }),
      'contentRefreshing',
    );
    assert.equal(
      resolveContentLoadState({
        hasContent: true,
        fetching: true,
        fetchingMore: true,
      }),
      'contentPaginating',
    );
    assert.equal(
      resolveListLoadState({ itemCount: 8, fetching: false, fetchingMore: true }),
      'contentPaginating',
    );
    assert.equal(
      resolveContentLoadState({ hasContent: true, fetching: false, error: true }),
      'content',
    );
  });

  it('drops stale content when the requested identity changes', () => {
    const productA = resourceIdentity('p1', null, null);
    const productB = resourceIdentity('p2', null, null);
    const queryA = resourceIdentity('search', 'red shoes');
    const queryB = resourceIdentity('search', 'blue coat');
    const collectionA = resourceIdentity('col-1');

    assert.equal(retainLoadedContent(productA, productA), true);
    assert.equal(retainLoadedContent(productB, productA), false);
    assert.equal(retainLoadedContent(queryB, queryA), false);
    assert.equal(retainLoadedContent(collectionA, collectionA), true);
    assert.equal(retainLoadedContent(collectionA, null), false);

    const keepSameProduct = retainLoadedContent(productA, productA);
    assert.equal(
      resolveContentLoadState({ hasContent: keepSameProduct, fetching: true }),
      'contentRefreshing',
    );

    const keepNewQuery = retainLoadedContent(queryB, queryA);
    assert.equal(
      resolveContentLoadState({ hasContent: keepNewQuery, fetching: true }),
      'skeleton',
    );
  });
});
