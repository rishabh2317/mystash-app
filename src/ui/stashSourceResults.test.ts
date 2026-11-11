import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FindSourceResult } from '@/src/services/findClient';
import type { CartLine } from '@/src/services/cartLineMap';
import type { PlaceStashItem } from '@/src/types/placeStash';
import { groupSourceRows, mergeSourceResults, sourcePlaceModel, sourceProductId, sourceProductModel, sourceResultKey } from './stashSourceResults';

const product = (n: number): FindSourceResult => ({ kind: 'product', result: { id: `source-${n}`, identityKey: `c:catalog-${n}`,
  title: `Product ${n}`, imageUrl: `https://fixture.invalid/${n}.jpg`, catalogProductId: `catalog-${n}`, discoveredProductId: null,
  matchKind: 'exact', saved: true, removed: false } });
const place = (n: number): FindSourceResult => ({ kind: 'place', result: { id: `source-place-${n}`, name: `Place ${n}`,
  placeId: `canonical-place-${n}`, resolution: 'resolved', locality: 'Paris', city: 'Paris', saved: true, removed: false } });

test('one source keeps its mixed cursor but presents all saved products and places in separate card grids', () => {
  const first = [product(1), place(1), product(2)];
  const second = [product(2), place(2), product(3), place(3), product(4)];
  const all = mergeSourceResults(first, second);
  assert.equal(all.length, 7, 'overlap at the page boundary is not repeated');
  assert.deepEqual(new Set(all.map(sourceResultKey)).size, 7);
  const rows = groupSourceRows(all, 2, 4, 3);
  assert.deepEqual(rows.map(row => row.kind), ['heading', 'products', 'products', 'heading', 'places', 'places']);
  assert.equal(rows[0].kind === 'heading' && rows[0].count, 4);
  assert.equal(rows[3].kind === 'heading' && rows[3].count, 3);
  assert.equal(rows.filter(row => row.kind === 'products').flatMap(row => row.items).length, 4);
  assert.equal(rows.filter(row => row.kind === 'places').flatMap(row => row.items).length, 3);
  assert.equal(groupSourceRows(all, 1, 4, 3).length, 9, 'large text uses one column');
});

test('product-only, place-only, and empty sources omit irrelevant sections', () => {
  assert.deepEqual(groupSourceRows([product(1)], 2, 1, 0).map(row => row.kind), ['heading', 'products']);
  assert.deepEqual(groupSourceRows([place(1)], 2, 0, 1).map(row => row.kind), ['heading', 'places']);
  assert.deepEqual(groupSourceRows([], 2, 0, 0), []);
});

test('Stash catalog enrichment is optional and canonical product navigation remains available', () => {
  const row = product(1);
  if (row.kind !== 'product') throw Error('Fixture');
  assert.equal(sourceProductId(row), 'catalog-1');
  assert.equal(sourceProductModel(row, [])?.title, 'Product 1');
  assert.equal(sourceProductModel(row, [])?.heroImage, 'https://fixture.invalid/1.jpg');
  const saved = { productId: 'catalog-1', product: { ...sourceProductModel(row, [])!, title: 'Enriched product' } } as CartLine;
  assert.equal(sourceProductModel(row, [saved])?.title, 'Enriched product');
});

test('place cards use Stash metadata when available and extracted data when enrichment fails', () => {
  const row = place(1);
  if (row.kind !== 'place') throw Error('Fixture');
  const fallback = sourcePlaceModel(row, 'import-1', []);
  assert.equal(fallback.name, 'Place 1');
  assert.equal(fallback.destination.kind, 'google_search');
  assert.equal(fallback.kind,'resolved');assert.equal(fallback.id,'canonical-place-1','photo identity must not depend on optional Stash enrichment');
  const saved = { ...fallback, id: 'canonical-place-1', name: 'Enriched place',
    sources: [{ contentSourceId: 'content', userImportId: 'import-1', contentSourcePlaceId: 'source-place-1', addedAt: 'now' }] } as PlaceStashItem;
  assert.equal(sourcePlaceModel(row, 'import-1', [saved]).name, 'Enriched place');
});

test('an unresolved source never acquires another canonical photo through a stale place ID',()=>{
  const row=place(1);if(row.kind!=='place')throw Error('Fixture');row.result.resolution='unresolved';
  const unrelated={kind:'resolved',id:'canonical-place-1',name:'Other place',category:null,localityLabel:null,formattedAddress:null,image:null,destination:{kind:'google_search',query:'other',url:'https://example.invalid'}} as PlaceStashItem;
  assert.equal(sourcePlaceModel(row,'import-1',[unrelated]).kind,'unresolved');
});
