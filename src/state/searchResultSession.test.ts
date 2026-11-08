import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { EMPTY_SECTIONS, emptySearchSession, mergeSearchSections, replaceSearchQuery, searchResponseIsCurrent } from './searchResultSession';

test('category data and cursor remain cached for the current query and reset immediately for new text', () => {
  const initial = emptySearchSession('linen');
  const cached = { ...initial, tabs: { ...initial.tabs,
    collection: { ...initial.tabs.collection, loaded: true, nextCursor: 'collection-page-2' } } };
  assert.equal(replaceSearchQuery(cached, ' linen '), cached);
  assert.equal(cached.tabs.collection.nextCursor, 'collection-page-2');
  const changed = replaceSearchQuery(cached, 'camera');
  assert.equal(changed.query, 'camera');
  assert.equal(changed.tabs.collection.loaded, false);
  assert.equal(changed.tabs.collection.nextCursor, null);
  assert.equal(changed.tabs.product.sections.products.length, 0);
  assert.equal(replaceSearchQuery(changed, '' ).query, '');
});

test('a URL remains ordinary search text and stale query, account, or refresh responses are rejected', () => {
  const url = 'https://example.com/video';
  const session = replaceSearchQuery(emptySearchSession(), url);
  assert.equal(session.query, url);
  assert.equal(searchResponseIsCurrent(session, url, url, 3, 3, 2, 2), true);
  assert.equal(searchResponseIsCurrent(session, 'new query', url, 3, 3, 2, 2), false);
  assert.equal(searchResponseIsCurrent(session, url, url, 3, 4, 2, 2), false);
  assert.equal(searchResponseIsCurrent(session, url, url, 3, 3, 2, 3), false);
});

test('overlapping pages deduplicate canonical collection and product identities', () => {
  const collection = (id: string) => ({ collectionId: id } as CollectionViewModel);
  const product = (id: string) => ({ id } as CatalogProductViewModel);
  const first = { ...EMPTY_SECTIONS, collections: [collection('a'), collection('b')], products: [product('p1')] };
  const second = { ...EMPTY_SECTIONS, collections: [collection('b'), collection('c')], products: [product('p1'), product('p2')] };
  const merged = mergeSearchSections(first, second);
  assert.deepEqual(merged.collections.map(row => row.collectionId), ['a', 'b', 'c']);
  assert.deepEqual(merged.products.map(row => row.id), ['p1', 'p2']);
});
