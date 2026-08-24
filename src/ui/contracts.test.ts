import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BAG_COPY,
  CONTROL_OWNERSHIP,
  controlOpacity,
  displayBagError,
  resolveControlPhase,
  STATUS_OWNERSHIP,
} from './contracts';

describe('control state contract', () => {
  it('resolves phase in disabled > pending > error > success > pressed > default order', () => {
    assert.equal(resolveControlPhase({ disabled: true, pending: true, success: true }), 'disabled');
    assert.equal(resolveControlPhase({ pending: true, success: true, pressed: true }), 'pending');
    assert.equal(resolveControlPhase({ error: true, success: true }), 'error');
    assert.equal(resolveControlPhase({ success: true, pressed: true }), 'success');
    assert.equal(resolveControlPhase({ pressed: true }), 'pressed');
    assert.equal(resolveControlPhase({}), 'default');
  });

  it('defines ownership for Bag-facing commerce without a second Cart UX', () => {
    assert.equal(BAG_COPY.add, 'Add to Bag');
    assert.equal(BAG_COPY.added, 'Added to Bag');
    assert.equal(BAG_COPY.view, 'View Bag');
    assert.equal(BAG_COPY.empty, 'Your Bag is empty');
    assert.equal(BAG_COPY.continueDiscovering, 'Continue discovering');
    assert.equal(BAG_COPY.keepInBag, 'Keep in Bag?');
    assert.equal(BAG_COPY.buy, 'View Product');
    assert.match(CONTROL_OWNERSHIP.addToBag, /Cart API \(internal\)/);
    assert.match(CONTROL_OWNERSHIP.bag, /\/cart/);
    assert.ok(STATUS_OWNERSHIP.error.includes('Retry'));
  });

  it('never shows Cart in user-facing Bag copy', () => {
    for (const value of Object.values(BAG_COPY)) {
      assert.equal(/cart/i.test(value), false, value);
    }
  });

  it('rewrites leaked cart wording for Bag UI without changing fallbacks', () => {
    assert.equal(displayBagError(null, BAG_COPY.loadError), BAG_COPY.loadError);
    assert.equal(displayBagError('Cart request failed (500)', BAG_COPY.loadError), 'Bag request failed (500)');
    assert.equal(displayBagError('Could not load cart.', BAG_COPY.loadError), 'Could not load Bag.');
  });

  it('dims pending and disabled controls', () => {
    assert.equal(controlOpacity('pending', 0.88), 0.7);
    assert.equal(controlOpacity('disabled', 0.88), 0.7);
    assert.equal(controlOpacity('pressed', 0.88), 0.88);
    assert.equal(controlOpacity('default', 0.88), 1);
  });
});
