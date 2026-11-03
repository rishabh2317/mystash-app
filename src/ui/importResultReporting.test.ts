import assert from 'node:assert/strict';
import { it } from 'node:test';
import { hydrateImportShares, type ImportShare } from '@/src/services/importShareMap';
import { mapImportShareToActivity, shareActivityDestination } from '@/src/ui/shareActivity';
import { importResultsChanged } from '@/src/hooks/importSharePoll';
import { bagHasInFlightShares } from '@/src/ui/bag';

function share(partial: Partial<ImportShare> = {}): ImportShare {
  return {
    importId: 'fixture', state: 'ready', kind: 'youtube', createdAt: '2026-10-28T00:00:00Z',
    contentSourceId: 'source', sourceUrl: 'https://example.invalid', productCount: 0,
    primaryProduct: null, products: [], resultVersion: 1, resultProductCount: 0,
    resultProducts: [], placeCount: 0, resolvedPlaceCount: 0, unverifiedPlaceCount: 0,
    productStatus: 'complete', placeStatus: 'complete', hasInFlight: false, canRetry: false,
    ...partial,
  };
}

it('labels place-only and mixed outcomes accurately without inventing products', () => {
  const placeOnly = share({ placeCount: 1, unverifiedPlaceCount: 1 });
  const view = mapImportShareToActivity(placeOnly);
  assert.equal(view.userState, 'places_found');
  assert.equal(view.subtitle, '1 place found');
  assert.equal(view.productCount, 0);
  assert.deepEqual(shareActivityDestination(placeOnly), { kind: 'places', path: '/stash?segment=places' });
  assert.equal(mapImportShareToActivity(share({ resultProductCount: 2, placeCount: 1 })).subtitle,
    '2 products · 1 place found');
  assert.equal(mapImportShareToActivity(share()).subtitle, 'No products or places found');
});

it('shows partial successes while polling and after sibling failure', () => {
  const running = share({ state: 'looking', placeCount: 1, productStatus: 'running', hasInFlight: true });
  const view = mapImportShareToActivity(running);
  assert.equal(view.userState, 'partial');
  assert.match(view.subtitle, /1 place found.*Finding products/);
  assert.equal(bagHasInFlightShares([running]), true);
  const failed = share({ state: 'couldnt_finish', placeCount: 1, productStatus: 'failed', canRetry: true });
  assert.equal(mapImportShareToActivity(failed).userState, 'partial');
  assert.match(mapImportShareToActivity(failed).subtitle, /1 place found.*Products couldn’t finish/);
  assert.equal(bagHasInFlightShares([failed]), false);
});

it('does not describe verification failures as successful empty searches', () => {
  const view = mapImportShareToActivity(share({ resultProductCount: 1, placeCount: 1,
    unverifiedPlaceCount: 1, placeStatus: 'failed', canRetry: true }));
  assert.match(view.subtitle, /1 product · 1 place found.*verification couldn’t finish/);
  assert.equal(view.canRetry, true);
  assert.doesNotMatch(view.subtitle, /No products|No places/);
});

it('retains legacy API and product-navigation compatibility; unknown zero-product READY is neutral', () => {
  const legacy = { ...share(), resultVersion: undefined, resultProductCount: undefined, resultProducts: undefined,
    productCount: 1, primaryProduct: { productId: 'p', title: 'Camera', imageUrl: null } };
  assert.equal(shareActivityDestination(legacy).kind, 'product');
  assert.equal(mapImportShareToActivity(legacy).subtitle, 'Camera');
  assert.equal(mapImportShareToActivity({ ...legacy, productCount: 0, primaryProduct: null }).subtitle, 'Results ready');
  const [oldWire] = hydrateImportShares([{ importId: 'old', state: 'ready', productCount: 2 }]);
  assert.equal(oldWire.productCount, 2);
  assert.equal(oldWire.resultVersion, undefined);
});

it('hydrates additive fields defensively and preserves partial product cards', () => {
  const [wire] = hydrateImportShares([share({ productCount: 0, resultProductCount: 1, resultProducts: [
    { productId: 'p', title: 'Camera', imageUrl: null },
  ], productStatus: 'complete', placeStatus: 'running', hasInFlight: true })]);
  const view = mapImportShareToActivity(wire);
  assert.equal(wire.productCount, 0);
  assert.equal(view.productCount, 1);
  assert.equal(view.products[0].productId, 'p');
  const [invalid] = hydrateImportShares([{ ...share(), placeCount: Infinity, resultProductCount: -2,
    productStatus: 'garbage', resultProducts: [{}] }]);
  assert.equal(invalid.placeCount, 0);
  assert.equal(invalid.resultProductCount, 0);
  assert.equal(invalid.productStatus, 'unknown');
  assert.deepEqual(invalid.resultProducts, []);
});

it('refreshes committed Places changes and promotions without an overall READY transition', () => {
  const before = share({ state: 'looking', placeStatus: 'running', productStatus: 'running', hasInFlight: true });
  const after = { ...before, placeCount: 1, unverifiedPlaceCount: 1, placeStatus: 'complete' as const };
  assert.equal(importResultsChanged([before], [after]), true);
  assert.equal(importResultsChanged([after], [{ ...after }]), false);
  assert.equal(importResultsChanged([after], [{ ...after, unverifiedPlaceCount: 0, resolvedPlaceCount: 1 }]), true);
});

it('late results do not erase the timed-out activity notice or restart polling', () => {
  const late = share({ state: 'couldnt_finish', timedOut: true, resultProductCount: 1,
    canRetry: true, hasInFlight: false });
  const view = mapImportShareToActivity(late);
  assert.equal(view.userState, 'partial');
  assert.match(view.subtitle, /1 product found.*Couldn’t finish in time/);
  assert.equal(bagHasInFlightShares([late]), false);
});

it('does not claim empty results while shared evidence is still finishing', () => {
  const view = mapImportShareToActivity(share({ state: 'looking', hasInFlight: true }));
  assert.equal(view.userState, 'processing');
  assert.equal(view.subtitle, 'Finishing discovery…');
});
