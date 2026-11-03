import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIND_ROUTES, findDetailPath, findHistoryMerge, findResultLabel, findStatus, safeFindUrl } from './find';
import { findDetailRows } from './findDetail';
import { findFixture,findDetailFixture } from './findTestFixtures';
import { APP_TAB_ITEMS } from './chrome';
import { readFileSync } from 'node:fs';
test('navigation exposes Find centrally while retaining Creator Studio and legacy share/import paths', () => {
  assert.deepEqual(APP_TAB_ITEMS.map(item => item.title),['Watch','Search','Find','Stash','Profile']);
  assert.equal(FIND_ROUTES.studio,'/(tabs)/create'); assert.equal(findDetailPath('capture/id'),'/find/capture%2Fid');
  assert.match(readFileSync('components/chrome/AppTabBar.tsx','utf8'),/name="create" options=\{\{ href: null/);
  assert.match(readFileSync('components/profile/PersonalProfile.tsx','utf8'),/title="Creator Studio"[\s\S]*onPress=\{onCreateCollection\}/);
  assert.match(readFileSync('app/shares.tsx','utf8'),/Redirect[\s\S]*find\?filter=all/);
  assert.match(readFileSync('app/import.tsx','utf8'),/submitUserImport/);
  const search = readFileSync('app/(tabs)/search.tsx','utf8');
  assert.match(search,/FIND_ROUTES.capture/); assert.match(search,/searchBlended/); assert.match(search,/searchAutocomplete/); assert.doesNotMatch(search,/submitUserImport/);
});
test('outcome messages preserve automatic saving, partial results, delayed work, empty and saving failures', () => {
  const item = findFixture(); assert.match(findStatus(item).message,/automatically/); assert.match(findResultLabel(item),/2 products.*1 place/);
  assert.match(findStatus(findFixture(2,'attention')).message,/Some results/);
  const delayed = findFixture(3,'processing'); delayed.outcome.delayed = true; assert.match(findStatus(delayed).message,/longer/);
  const empty = findFixture(); empty.outcome = { ...empty.outcome,result: 'empty',foundProducts: 0,foundPlaces: 0,savedProducts: 0,savedPlaces: 0 };
  assert.match(findStatus(empty).message,/couldn’t identify/); assert.match(findResultLabel(empty),/No products/);
  item.outcome.stashSync = 'failed'; assert.match(findStatus(item).label,/Saving/);
});
test('result rows deduplicate identities, retain similar labeling and provide explicit removal/restoration tokens', () => {
  const detail = findDetailFixture(); detail.products.push({ ...detail.products[0],id: 'duplicate' });
  const rows = findDetailRows(detail); assert.equal(rows.length,4);
  assert.equal(rows[0].membership?.identity,detail.products[0].identityKey); assert.equal(rows[1].removed,true);
  assert.match(rows[2].subtitle,/Similar product/); assert.equal(rows[2].membership?.candidate,'a'.repeat(64));
  assert.equal(rows[3].membership?.kind,'places');
});
test('unsafe media/source URLs fail closed and newer rows win without synthesizing state', () => {
  for (const url of ['javascript:alert(1)','file:///private/image.png','https://user:password@host.example/a']) assert.equal(safeFindUrl(url),null);
  const old = findFixture(1,'processing'), updated = { ...old,outcome: { ...old.outcome,category: 'completed' as const } };
  assert.deepEqual(findHistoryMerge([old],[updated],[],'processing'),[]);
});
