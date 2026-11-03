import assert from 'node:assert/strict';
import { it } from 'node:test';
import { normalizedPlaceCategory } from './placeCategories';
import { buildPlacesHome, hydratePlaceStashItem, hydratePlaceStashPage, placeStashItemKey, placesColumnCount, unifiedPlaceStashItems } from './stashPlaces';
import { placeSourceVideos, withPlaceSourceVideos } from './placeSourceVideo';

const youtube = { url: 'https://youtu.be/dQw4w9WgXcQ', thumbnailUrl: 'https://fixture.invalid/source.jpg' };
const instagram = { url: 'https://www.instagram.com/reel/ABC_123/', thumbnailUrl: null };
const destination = { kind: 'google_search', query: 'Palace London', url: 'https://www.google.com/search?q=Palace' };
function raw(id: string, extra: Record<string, unknown> = {}) {
  return { kind: 'unresolved', leadId: id, saveId: id, name: 'Buckingham Palace', locationContext: 'London', category: 'Attraction',
    addedAt: '2026-10-30T00:00:00Z', uncertainty: 'unconfirmed', destination, image: { kind: 'source', url: youtube.thumbnailUrl },
    sourceVideo: youtube, ...extra };
}
function item(id: string, extra: Record<string, unknown> = {}) { return hydratePlaceStashItem(raw(id, extra))!; }

it('preserves lead categories, timestamps, group identity and all authorized source videos through hydration', () => {
  const sources = [{ contentSourceId: 'a', userImportId: 'import-a', contentSourcePlaceId: 'hyp-a', addedAt: '2026-10-30', sourceVideo: youtube },
    { contentSourceId: 'b', userImportId: 'import-b', contentSourcePlaceId: 'hyp-b', addedAt: '2026-10-30', sourceVideo: instagram }];
  const mapped = item('one', { presentationGroupId: 'group', sources, sourceVideos: [youtube, instagram], extractedCategory: 'Attraction', categorySource: 'extracted' });
  assert.equal(mapped.category, 'Attraction'); assert.equal(mapped.extractedCategory, 'Attraction'); assert.equal(mapped.categorySource, 'extracted'); assert.equal(mapped.addedAt, '2026-10-30T00:00:00Z');
  assert.equal(mapped.presentationGroupId, 'group'); assert.deepEqual(mapped.sources, sources);
  assert.deepEqual(placeSourceVideos(mapped), [youtube, instagram]);
  const page = hydratePlaceStashPage({ items: [raw('one')], itemCount: 20, displayItemCount: 19, nextCursor: 'cursor' });
  assert.equal(page.itemCount, 20); assert.equal(page.displayItemCount, 19); assert.equal(page.nextCursor, 'cursor');
});

it('normalizes only supported category evidence without classifying names or guessing hotels/restaurants', () => {
  for (const [raw, expected] of [['Cafe', 'cafes'], ['café', 'cafes'], ['shopping_mall', 'shopping'],
    ['historical landmark', 'attractions'], ['Hotel', 'hotels'], ['Accommodation', 'stays'], ['City', 'destinations'],
    ['Brewery', 'other'], ['Unknown', 'other'], ['Hotel California', 'other'], ['', 'other']]) {
    assert.equal(normalizedPlaceCategory(raw).key, expected, raw);
  }
});

it('deduplicates only explicitly proven refinements and retains every save/source and Analytics entity', () => {
  const simple = item('save-a', { presentationGroupId: 'group', sourceVideos: [youtube] });
  const richer = item('save-b', { presentationGroupId: 'group', locationContext: 'Westminster, London', sourceVideo: instagram });
  const result = unifiedPlaceStashItems([simple, richer]);
  assert.equal(result.length, 1); assert.equal(result[0].id, 'save-b');
  assert.equal(placeStashItemKey(result[0]), 'lead-group:group');
  assert.deepEqual(new Set(result[0].groupedSaveIds), new Set(['save-a', 'save-b']));
  assert.deepEqual(new Set(placeSourceVideos(result[0]).map(video => video.url)), new Set([youtube.url, instagram.url]));
  assert.equal(simple.id, 'save-a', 'original records are not mutated');
  assert.equal(unifiedPlaceStashItems([item('one'), item('two')]).length, 2, 'same name is not identity');
});

it('builds distinct category counts, dated Recent order, and real collages from the unified dataset', () => {
  const items = [item('old', { addedAt: '2026-10-20', category: 'Cafe' }), item('new', { addedAt: '2026-10-30', category: 'Cafe' }),
    item('stay', { category: 'Accommodation', image: null }), item('hotel', { category: 'Hotel' })];
  const home = buildPlacesHome(items);
  assert.equal(home.count, 4); assert.equal(home.recent[home.recent.length - 1].id, 'old');
  assert.equal(home.categories.find(c => c.key === 'cafes')?.count, 2);
  assert.deepEqual(home.categories.find(c => c.key === 'cafes')?.previewUrls, [youtube.thumbnailUrl]);
  assert.equal(home.categories.find(c => c.key === 'stays')?.previewUrls.length, 0);
  assert.equal(buildPlacesHome(Array.from({ length: 20 }, (_, i) => item(String(i)))).recent.length, 8);
  const legacy = [item('first', { addedAt: undefined }), item('second', { addedAt: undefined })];
  assert.deepEqual(buildPlacesHome(legacy).recent.map(i => i.id), ['first', 'second']);
});

it('keeps two columns on phones and a readable single column at large text or very narrow widths', () => {
  assert.equal(placesColumnCount(390, 1), 2); assert.equal(placesColumnCount(320, 1), 2);
  assert.equal(placesColumnCount(300, 1), 1); assert.equal(placesColumnCount(390, 2), 1);
});

it('legacy source recovery retains all exact authorized matches while explicit null remains authoritative', () => {
  const legacy = item('legacy', { sourceVideo: undefined, sources: [
    { contentSourceId: 'a', userImportId: 'import-a', contentSourcePlaceId: 'h-a', addedAt: '2026-10-30' },
    { contentSourceId: 'b', userImportId: 'import-b', contentSourcePlaceId: 'h-b', addedAt: '2026-10-30' },
  ] });
  const shares = [{ contentSourceId: 'a', importId: 'import-a', sourceUrl: youtube.url },
    { contentSourceId: 'b', importId: 'import-b', sourceUrl: instagram.url }];
  assert.equal(placeSourceVideos(withPlaceSourceVideos([legacy], shares)[0]).length, 2);
  assert.deepEqual(withPlaceSourceVideos([{ ...legacy, sourceVideo: null }], shares)[0].sourceVideo, null);
  const unsafe = item('unsafe', { sourceVideos: [{ url: 'javascript:bad', thumbnailUrl: null }] });
  assert.deepEqual(placeSourceVideos(unsafe), [youtube]);
});
