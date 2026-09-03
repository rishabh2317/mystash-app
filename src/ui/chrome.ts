import { BAG_COPY } from '@/src/ui/contracts';

export type TopBarMode = 'immersive' | 'page';

/** Tab destinations. Bag is chrome-only, never a tab. */
export const APP_TAB_ITEMS = [
  { name: 'index', title: 'Home' },
  { name: 'search', title: 'Search' },
  { name: 'create', title: 'Create' },
  { name: 'profile', title: 'Profile' },
] as const;

/**
 * Routes whose tab bar sits on media and therefore uses the immersive
 * treatment. The tab bar itself is never forked — only its variant changes.
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
 * Badge count for BagButton.
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

export function bagScreenTitle(itemCount: number): string {
  if (itemCount <= 0) return BAG_COPY.noun;
  return `${BAG_COPY.noun} · ${itemCount}`;
}

export function formatBagBadgeText(badgeCount: number): string {
  if (badgeCount <= 0) return '';
  return badgeCount > 99 ? '99+' : String(badgeCount);
}
