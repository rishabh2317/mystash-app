import assert from 'node:assert/strict';
import { it } from 'node:test';
import { hydrateImportShares, type ImportShare } from '@/src/services/importShareMap';
import type { FindOutcome } from '../../backend/src/user-import/find/contract';
import { mapImportShareToActivity, shareActivityDestination } from '@/src/ui/shareActivity';
import { importResultsChanged } from '@/src/hooks/importSharePoll';
import { bagHasInFlightShares } from '@/src/ui/bag';

function share(outcome: Partial<FindOutcome> = {}, products: ImportShare['products'] = []): ImportShare {
  return hydrateImportShares([{ importId: 'fixture', kind: 'youtube', createdAt: '2026-11-03T00:00:00Z', products,
    findOutcome: { version: 1, category: 'completed', result: 'empty', products: 'complete', places: 'complete',
      foundProducts: 0, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0, savedProducts: 0, savedPlaces: 0, stashSync: 'complete',
      canRetryExtraction: false, canRetrySaving: false, extractionActive: false, delayed: false, finishedAt: null, ...outcome } }])[0];
}
it('labels place-only, mixed and empty outcomes using authoritative counts', () => {
  const place = share({ foundPlaces: 1, result: 'found' });
  assert.equal(mapImportShareToActivity(place).userState, 'places_found');
  assert.equal(mapImportShareToActivity(place).subtitle, '1 place found');
  assert.deepEqual(shareActivityDestination(place), { kind: 'places', path: '/stash?segment=places' });
  assert.equal(mapImportShareToActivity(share({ foundProducts: 2, foundPlaces: 1 })).subtitle, '2 products · 1 place found');
  assert.equal(mapImportShareToActivity(share()).subtitle, 'No products or places found');
});
it('retains partial successes and polls until active work finishes', () => {
  const active = share({ category: 'processing', foundPlaces: 1, products: 'running', extractionActive: true });
  assert.equal(mapImportShareToActivity(active).userState, 'partial');
  assert.match(mapImportShareToActivity(active).subtitle, /1 place found.*Finding products/);
  assert.equal(bagHasInFlightShares([active]), true);
  const failed = share({ category: 'attention', result: 'partial', foundPlaces: 1, products: 'failed', canRetryExtraction: true });
  assert.equal(mapImportShareToActivity(failed).userState, 'partial');
  assert.equal(bagHasInFlightShares([failed]), false);
});
it('saving failure is distinct from extraction failure and remains retryable', () => {
  const failed = share({ category: 'attention', result: 'found', foundProducts: 1, stashSync: 'failed', canRetrySaving: true });
  assert.match(mapImportShareToActivity(failed).subtitle, /Saving needs another try/);
  assert.equal(failed.canRetry, true); assert.equal(failed.productStatus, 'complete');
});
it('requires the current contract and rejects malformed outcomes instead of guessing completion', () => {
  assert.throws(() => hydrateImportShares([{ importId: 'old', state: 'ready', productCount: 2 }]), /outcome unavailable/);
  assert.throws(() => hydrateImportShares([{ ...share(), findOutcome: { ...share().findOutcome, foundProducts: -1 } }]), /Incompatible/);
});
it('hydrates partial product cards and ignores contradictory legacy aliases', () => {
  const original = share({ foundProducts: 1, places: 'running', category: 'processing', extractionActive: true },
    [{ productId: 'p', title: 'Camera', imageUrl: null }]);
  const wire = hydrateImportShares([{ ...original, state: 'couldnt_finish', productCount: 88, hasInFlight: false }])[0];
  assert.equal(wire.productCount, 1); assert.equal(wire.hasInFlight, true);
  assert.equal(mapImportShareToActivity(wire).products[0].productId, 'p');
  assert.equal(shareActivityDestination(wire).kind, 'product');
});
it('refreshes saved counts, save recovery, and late completion without relying on state transitions', () => {
  const before = share({ foundProducts: 1, stashSync: 'failed', canRetrySaving: true });
  const after = share({ foundProducts: 1, savedProducts: 1 });
  assert.equal(importResultsChanged([before], [after]), true);
  assert.equal(importResultsChanged([after], [{ ...after }]), false);
});
it('delayed work keeps polling and late success clears the delay notice', () => {
  const delayed = share({ category: 'attention', products: 'running', extractionActive: true, delayed: true });
  assert.match(mapImportShareToActivity(delayed).subtitle, /Taking longer/);
  assert.equal(bagHasInFlightShares([delayed]), true); assert.equal(delayed.canRetry, false);
  const done = share({ foundProducts: 1, result: 'found' });
  assert.doesNotMatch(mapImportShareToActivity(done).subtitle, /longer|finish in time/);
  assert.equal(bagHasInFlightShares([done]), false);
});
it('does not claim empty results while source evidence is finishing', () => {
  const value = share({ category: 'processing', extractionActive: true });
  assert.equal(mapImportShareToActivity(value).subtitle, 'Finishing discovery…');
});

it('refreshes Stash when a place is verified without changing its total count', () => {
  const lead = share({ foundPlaces: 1, unverifiedPlaces: 1 });
  const verified = share({ foundPlaces: 1, resolvedPlaces: 1 });
  assert.equal(importResultsChanged([lead], [verified]), true);
  assert.equal(verified.resolvedPlaceCount, 1); assert.equal(verified.unverifiedPlaceCount, 0);
});
