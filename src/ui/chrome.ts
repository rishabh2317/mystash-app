import { BAG_COPY } from '@/src/ui/contracts';

export type TopBarMode = 'immersive' | 'page';

/**
 * Canonical footer destinations (user-facing labels).
 * Watch keeps the Home feed route (`index`). Stash opens existing `/cart`.
 */
export const APP_TAB_ITEMS = [
  { name: 'index', title: 'Watch', icon: 'play-outline' },
  { name: 'search', title: 'Search', icon: 'search-outline' },
  { name: 'create', title: 'Create', icon: 'add-outline' },
  { name: 'stash', title: 'Stash', icon: 'bag-handle-outline' },
  { name: 'profile', title: 'Profile', icon: 'person-outline' },
] as const;

/** Refined outline icon size for the footer (not oversized). */
export const APP_TAB_ICON_SIZE = 22;

/**
 * Routes whose tab bar sits on the Watch feed and stays solid black.
 * The tab bar itself is never forked — only its surface variant changes.
 */
export function isImmersiveTabRoute(pathname: string | null | undefined): boolean {
  const path = pathname?.trim();
  if (!path) return false;
  return (
    path === '/' ||
    path === '/index' ||
    path === '/(tabs)' ||
    path === '/(tabs)/index' ||
    path.endsWith('/(tabs)/index')
  );
}

/**
 * Badge count for the Stash tab icon.
 * Unsigned users never see a count (cart may still exist internally).
 */
export function bagBadgeCount(signedIn: boolean, itemCount: number): number {
  if (!signedIn || itemCount <= 0) return 0;
  return itemCount;
}

export function bagButtonAccessibilityLabel(badgeCount: number): string {
  if (badgeCount <= 0) return BAG_COPY.view;
  return `${BAG_COPY.noun}, ${badgeCount} items`;
}

/** TopBar title on /cart — count lives in the editorial Stash header. */
export function bagScreenTitle(_itemCount?: number): string {
  return BAG_COPY.yourStash;
}

export function formatBagBadgeText(badgeCount: number): string {
  if (badgeCount <= 0) return '';
  return badgeCount > 99 ? '99+' : String(badgeCount);
}
