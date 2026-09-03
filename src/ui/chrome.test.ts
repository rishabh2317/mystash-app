import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BAG_COPY } from './contracts';
import {
  APP_TAB_ITEMS,
  bagBadgeCount,
  bagButtonAccessibilityLabel,
  bagScreenTitle,
  formatBagBadgeText,
  isImmersiveTabRoute,
} from './chrome';

describe('UX-B.2 chrome contracts', () => {
  it('keeps four tabs and never includes Bag as a tab', () => {
    assert.deepEqual(
      APP_TAB_ITEMS.map((t) => t.title),
      ['Home', 'Search', 'Create', 'Profile'],
    );
    assert.ok(!APP_TAB_ITEMS.some((t) => /bag|cart/i.test(t.title)));
  });

  it('hides Bag badge unless signed in with items', () => {
    assert.equal(bagBadgeCount(false, 3), 0);
    assert.equal(bagBadgeCount(true, 0), 0);
    assert.equal(bagBadgeCount(true, 4), 4);
  });

  it('uses View Bag / Bag copy for chrome and the /cart screen title', () => {
    assert.equal(bagButtonAccessibilityLabel(0), BAG_COPY.view);
    assert.equal(bagButtonAccessibilityLabel(2), 'Bag, 2 items');
    assert.equal(bagScreenTitle(0), BAG_COPY.noun);
    assert.equal(bagScreenTitle(3), 'Bag · 3');
    assert.equal(formatBagBadgeText(100), '99+');
    assert.equal(BAG_COPY.continueDiscovering, 'Continue discovering');
  });

  it('marks only the Home feed route as immersive chrome', () => {
    assert.ok(isImmersiveTabRoute('/'));
    assert.ok(isImmersiveTabRoute('/(tabs)/index'));
    assert.ok(isImmersiveTabRoute('/index'));
    assert.ok(!isImmersiveTabRoute('/search'));
    assert.ok(!isImmersiveTabRoute('/(tabs)/profile'));
    assert.ok(!isImmersiveTabRoute(''));
    assert.ok(!isImmersiveTabRoute(null));
  });
});
