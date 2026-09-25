import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BAG_COPY } from './contracts';
import {
  APP_TAB_ICON_SIZE,
  APP_TAB_ITEMS,
  bagBadgeCount,
  bagButtonAccessibilityLabel,
  bagScreenTitle,
  formatBagBadgeText,
  isImmersiveTabRoute,
} from './chrome';

const ROOT = join(import.meta.dirname, '..', '..');

describe('UX-B.2 chrome contracts', () => {
  it('keeps five footer tabs: Watch · Search · Create · Stash · Profile', () => {
    assert.deepEqual(
      APP_TAB_ITEMS.map((t) => t.title),
      ['Watch', 'Search', 'Create', 'Stash', 'Profile'],
    );
    assert.deepEqual(
      APP_TAB_ITEMS.map((t) => t.name),
      ['index', 'search', 'create', 'stash', 'profile'],
    );
    assert.equal(APP_TAB_ITEMS[0].icon, 'play-outline');
    assert.equal(APP_TAB_ITEMS[3].icon, 'bag-handle-outline');
    assert.ok(APP_TAB_ICON_SIZE < 28);
  });

  it('wires AppTabBar to canvasSoft/black surfaces and Stash as an in-tab screen', () => {
    const bar = readFileSync(join(ROOT, 'components/chrome/AppTabBar.tsx'), 'utf8');
    const top = readFileSync(join(ROOT, 'components/chrome/TopBar.tsx'), 'utf8');
    const stash = readFileSync(join(ROOT, 'app/(tabs)/stash.tsx'), 'utf8');
    const cart = readFileSync(join(ROOT, 'app/cart.tsx'), 'utf8');
    const search = readFileSync(join(ROOT, 'app/(tabs)/search.tsx'), 'utf8');
    assert.match(bar, /WATCH_TAB_BAR_BG/);
    assert.match(bar, /canvasSoft/);
    assert.match(bar, /TAB_BAR_CONTENT_HEIGHT/);
    assert.match(bar, /Ionicons/);
    assert.match(bar, /StashTabIcon/);
    assert.match(bar, /formatBagBadgeText/);
    assert.match(bar, /tokens\.color\.danger/);
    assert.doesNotMatch(bar, /tokens\.color\.tabBar/);
    assert.doesNotMatch(bar, /router\.push\('\/cart'\)/);
    assert.doesNotMatch(bar, /house\.fill|plus\.circle\.fill/);
    assert.match(top, /textAlign: 'left'/);
    assert.match(top, /canvasSoft/);
    assert.doesNotMatch(top, /textAlign: 'center'/);
    assert.doesNotMatch(top, /BagButton/);
    assert.match(search, /tokens\.color\.canvasSoft/);
    assert.doesNotMatch(search, /softCanvasGradient/);
    assert.match(stash, /useBottomTabBarHeight/);
    assert.match(stash, /BAG_COPY\.yourStash/);
    assert.match(cart, /Redirect/);
    assert.match(cart, /\/stash/);
  });

  it('hides Stash badge unless signed in with items', () => {
    assert.equal(bagBadgeCount(false, 3), 0);
    assert.equal(bagBadgeCount(true, 0), 0);
    assert.equal(bagBadgeCount(true, 4), 4);
  });

  it('uses View Stash / Your Stash copy for chrome and the /cart screen title', () => {
    assert.equal(bagButtonAccessibilityLabel(0), BAG_COPY.view);
    assert.equal(bagButtonAccessibilityLabel(2), 'Stash, 2 items');
    assert.equal(bagScreenTitle(0), BAG_COPY.yourStash);
    assert.equal(bagScreenTitle(3), BAG_COPY.yourStash);
    assert.equal(formatBagBadgeText(100), '99+');
    assert.equal(BAG_COPY.continueDiscovering, 'Continue discovering');
  });

  it('marks only the Watch/Home feed route as immersive chrome', () => {
    assert.ok(isImmersiveTabRoute('/'));
    assert.ok(isImmersiveTabRoute('/(tabs)/index'));
    assert.ok(isImmersiveTabRoute('/index'));
    assert.ok(!isImmersiveTabRoute('/search'));
    assert.ok(!isImmersiveTabRoute('/(tabs)/profile'));
    assert.ok(!isImmersiveTabRoute('/(tabs)/stash'));
    assert.ok(!isImmersiveTabRoute(''));
    assert.ok(!isImmersiveTabRoute(null));
  });
});
