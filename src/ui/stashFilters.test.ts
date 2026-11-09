import assert from 'node:assert/strict';
import { it } from 'node:test';
import { activeStashFilter, filterRecentStash, stashFilterOptions } from './stashFilters';
import { bagCategoryKey, buildStashHome, type BagItemView } from './bag';
import { buildPlacesHome, hydratePlaceStashItem, placeCategoryText } from './stashPlaces';
import { normalizedPlaceCategory } from './placeCategories';
import { FILTER_CHIP_DEPTH, getThemeTokens, stashFilterChipChrome } from '../theme/tokens';

it('All is distinct from real categories and only represented categories become options', () => {
  const filters = stashFilterOptions([{ key: 'Cafe', title: 'Cafés' }, { key: 'All', title: 'All things' }, { key: 'Cafe', title: 'Cafés' }]);
  assert.deepEqual(filters.map(f => f.key), [null, 'Cafe', 'All']);
  assert.equal(activeStashFilter(filters, 'Cafe'), 'Cafe');
  assert.equal(activeStashFilter(filters, 'Hotels'), null);
  assert.deepEqual(stashFilterOptions([]).map(f => f.label), ['All']);
});

it('filters older Products beyond the eight-item preview using the entire newest-first dataset', () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ cartItemId: String(i), title: `Product ${i}`,
    addedAt: new Date(Date.UTC(2026, 9, 30, 0, i)).toISOString(), category: i < 5 ? 'Fashion' : 'Electronics', imageUrl: null,
  } as BagItemView));
  const home = buildStashHome(items);
  assert.equal(home.recent.length, 8, 'legacy discovery preview remains unchanged for other consumers');
  const all = filterRecentStash(items, null, i => bagCategoryKey(i.category));
  assert.equal(all.length, 15); assert.equal(all[0].cartItemId, '14');
  const fashion = filterRecentStash(items, 'Fashion', i => bagCategoryKey(i.category));
  assert.deepEqual(fashion.map(i => i.cartItemId), ['4', '3', '2', '1', '0']);
  assert.equal(stashFilterOptions(home.categories).length, 3);
  assert.equal(items[0].cartItemId, '0', 'source data is not reordered in place');
});

it('filters the whole unified Places dataset, including older leads, without losing resolution data', () => {
  const items = Array.from({ length: 15 }, (_, i) => hydratePlaceStashItem({ kind: 'unresolved', saveId: String(i), leadId: String(i),
    name: `Place ${i}`, category: i < 5 ? 'Cafe' : 'Attraction', addedAt: new Date(Date.UTC(2026, 9, 30, 0, i)).toISOString(),
    uncertainty: 'ambiguous', destination: { kind: 'google_search', query: 'place', url: 'https://www.google.com/search?q=place' } })!);
  const home = buildPlacesHome(items);
  assert.equal(home.recent.length, 8);
  const cafes = filterRecentStash(home.items, 'cafes', i => normalizedPlaceCategory(i.category).key);
  assert.deepEqual(cafes.map(i => i.id), ['4', '3', '2', '1', '0']);
  assert.ok(cafes.every(i => i.kind === 'unresolved' && i.resolutionStatus === 'unverified' && i.uncertainty === 'ambiguous'));
  assert.equal(filterRecentStash(home.items, null, i => normalizedPlaceCategory(i.category).key).length, 15);
});

it('retains stable ties and undated legacy order while comparing actual timestamp instants', () => {
  const items = [{ id: 'undated-a' }, { id: 'earlier', addedAt: '2026-10-30T10:00:00+05:30' },
    { id: 'newer', addedAt: '2026-10-30T05:00:00Z' }, { id: 'tie', addedAt: '2026-10-30T05:00:00Z' }, { id: 'undated-b', addedAt: 'invalid' }];
  assert.deepEqual(filterRecentStash(items, null, () => 'other').map(i => i.id), ['newer', 'tie', 'earlier', 'undated-a', 'undated-b']);
});

it('category text uses only supplied types, deduplicates labels, and never invents restaurant/bar types', () => {
  assert.equal(placeCategoryText({ category: 'Restaurant', extractedCategory: 'Bar' }), 'Restaurant · Bar');
  assert.equal(placeCategoryText({ category: 'historical_landmark', extractedCategory: 'Attraction' }), 'Historical landmark · Attraction');
  assert.equal(placeCategoryText({ category: 'Cafe', extractedCategory: 'Café' }), 'Cafe');
  assert.equal(placeCategoryText({ category: 'Brewery' }), 'Brewery');
  assert.equal(placeCategoryText({ category: 'Shopping Mall', extractedCategory: 'shopping mall' }), 'Shopping mall');
  assert.equal(placeCategoryText({ category: 'Restaurant · Bar' }), 'Restaurant · Bar');
  assert.equal(placeCategoryText({ category: 'restaurant/bar' }), 'Restaurant · Bar');
  assert.equal(placeCategoryText({ category: 'N/A · unknown · Bar' }), 'Bar');
  assert.equal(placeCategoryText({ category: null }), null);
  assert.equal(placeCategoryText({ category: 'Unknown', extractedCategory: 'N/A' }), null);
});

it('chips have a raised edge and a shadow-free pressed state in both themes', () => {
  for (const theme of ['titanium', 'nebula'] as const) {
    const tokens = getThemeTokens(theme);
    const off = stashFilterChipChrome(tokens, false), on = stashFilterChipChrome(tokens, true);
    assert.equal(on.borderRadius, tokens.radius.pill); assert.equal(off.borderWidth, tokens.stroke.thin);
    assert.equal(off.backgroundColor, FILTER_CHIP_DEPTH[theme].raised);
    assert.equal(on.backgroundColor, FILTER_CHIP_DEPTH[theme].pressed);
    assert.notEqual(off.borderTopColor, on.borderTopColor);
    assert.ok(off.elevation > 0); assert.equal(on.elevation, 0);
    assert.ok(off.shadowOpacity > 0); assert.equal(on.shadowOpacity, 0);
  }
});
