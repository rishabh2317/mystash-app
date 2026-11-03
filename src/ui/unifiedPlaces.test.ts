import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import type { PlaceStashItem, PlaceStashAttribution } from '@/src/types/placeStash';
import { hydratePlaceStashItem, placeCardView, placeStashItemKey, unifiedPlaceStashItems } from './stashPlaces';

const destination = { kind: 'google_search' as const, query: 'Cafe Paris', url: 'https://www.google.com/search?q=Cafe+Paris' };
const source = (id: string, hypothesis = `hyp-${id}`): NonNullable<PlaceStashAttribution['sources']>[number] => ({
  contentSourceId: id, contentSourcePlaceId: hypothesis, userImportId: `import-${id}`, addedAt: '2026-10-28T00:00:00Z',
});
const lead = (id: string, sources = [source(id)]): PlaceStashItem => ({ kind: 'unresolved', id, saveId: id,
  name: 'Cafe', locationContext: 'Paris', uncertainty: 'ambiguous', image: null, destination, sources });
const place = (id: string, sources = [source(id)]): PlaceStashItem => ({ kind: 'resolved', id, saveId: `save-${id}`,
  name: 'Cafe', category: 'Cafe', localityLabel: 'Paris', formattedAddress: null, image: null, destination, sources });

it('interleaves resolved and unverified places without grouping or changing server order', () => {
  const input = [lead('a'), place('b'), lead('c'), place('d')];
  assert.deepEqual(unifiedPlaceStashItems(input), input);
  assert.deepEqual(unifiedPlaceStashItems([]), []);
});

it('deduplicates canonical IDs, retains every provenance link, and never mutates API payloads', () => {
  const input = [place('same', [source('one')]), lead('other'), place('same', [source('two'), source('one')])];
  const original = structuredClone(input);
  const result = unifiedPlaceStashItems(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'resolved');
  assert.equal(result[0].id, 'same');
  assert.deepEqual(result[0].sources, [source('one'), source('two')]);
  assert.equal(result[0].destination, input[0].destination);
  assert.deepEqual(input, original);
});

it('promotes only explicit hypothesis aliases, in either payload order, and keeps source fallback imagery', () => {
  const unresolved = { ...lead('old', [source('one', 'known-hyp')]), image: { kind: 'source' as const, url: 'https://fixture.invalid/video.jpg' } };
  const resolved = place('canonical', [source('one', 'known-hyp'), source('two')]);
  for (const input of [[unresolved, resolved], [resolved, unresolved]]) {
    const result = unifiedPlaceStashItems(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'resolved');
    assert.equal(result[0].id, 'canonical');
    assert.equal(result[0].saveId, 'save-canonical');
    assert.equal(result[0].image?.kind, 'source');
    assert.equal(result[0].sources?.length, 2);
  }
});

it('recognizes the same saved card during promotion without name-based matching', () => {
  const result = unifiedPlaceStashItems([{ ...lead('old', []), saveId: 'same-card' }, { ...place('canonical', []), saveId: 'same-card' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'resolved');
});

it('never merges similar names, identical locations, or conflicting canonical identities', () => {
  const sameName = [place('one'), place('two'), lead('three')];
  assert.equal(unifiedPlaceStashItems(sameName).length, 3);
  const conflicting = [place('one', [source('same')]), place('two', [source('same')]), lead('three', [source('same')])];
  assert.equal(unifiedPlaceStashItems(conflicting).length, 3);
});

it('deduplicates repeated leads only by identity and retains separate import provenance', () => {
  const result = unifiedPlaceStashItems([lead('one', [source('video')]), lead('one', [{ ...source('video'), userImportId: 'another-import' }]), lead('two')]);
  assert.equal(result.length, 2);
  assert.equal(result[0].sources?.length, 2);
  assert.equal(placeCardView(result[0]).sourceLabel, 'From your saved video');
});

it('keeps stable save keys through promotion and preserves legacy entity keys/analytics IDs', () => {
  const before = lead('save');
  const after = { ...place('canonical'), saveId: 'save' };
  assert.equal(placeStashItemKey(before), placeStashItemKey(after));
  assert.equal(after.id, 'canonical');
  assert.equal(before.id, 'save');
  assert.equal(placeStashItemKey({ ...place('legacy'), saveId: undefined }), 'resolved:legacy');
  assert.equal(placeStashItemKey({ ...lead('legacy'), saveId: undefined }), 'unresolved:legacy');
});

it('normalizes explicit resolution status on legacy payloads without inventing save IDs or source links', () => {
  const item = hydratePlaceStashItem({ kind: 'unresolved', leadId: 'old', name: 'Cafe', destination });
  assert.equal(item?.resolutionStatus, 'unverified');
  assert.equal(item?.saveId, undefined);
  assert.equal(item?.sources, undefined);
});

it('labels video evidence accurately and counts distinct source videos without inventing fields', () => {
  const view = placeCardView({ ...place('one', [source('a'), { ...source('a'), userImportId: 'another' }, source('b')]),
    image: { kind: 'source', url: 'https://fixture.invalid/video.jpg' } });
  assert.equal(view.sourceLabel, 'From 2 saved videos');
  assert.equal(view.imageLabel, 'Saved video preview');
  assert.equal(view.statusLabel, null);
  assert.equal(placeCardView(lead('one')).statusLabel, 'Unverified');
  assert.equal(placeCardView(place('empty', [])).imageLabel, null);
  assert.equal(placeCardView(place('empty', [])).sourceLabel, null);
});

it('uses a known canonical address when locality is absent and leaves missing location blank', () => {
  const known = place('one');
  if (known.kind !== 'resolved') throw new Error('Invalid fixture');
  assert.equal(placeCardView({ ...known, localityLabel: null, formattedAddress: '172 Boulevard Saint-Germain' }).location,
    '172 Boulevard Saint-Germain');
  assert.equal(placeCardView({ ...known, localityLabel: null }).location, null);
});

it('retains existing Analytics event contracts and native external navigation', () => {
  const card = readFileSync('components/place/PlaceCard.tsx', 'utf8');
  assert.match(card, /useQualifiedExposure\('place\.impression',entityType,item\.id\)/);
  assert.match(card, /enqueueObservation\('place\.outbound_requested',entityType,item\.id,'stash',\{destination_kind:'search'\}\)/);
  assert.match(card, /onSearch\(view\.searchUrl\)/);
  const screen = readFileSync('app/(tabs)/stash.tsx', 'utf8');
  assert.match(screen, /Linking\.openURL\(url\)/);
  assert.match(screen, /placesScope\.isCurrent\(ticket\)/);
  assert.match(screen, /placesData\.owner === user\?\.id/);
});
