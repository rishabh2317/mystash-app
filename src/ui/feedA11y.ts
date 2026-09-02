export const FEED_MIN_HIT_TARGET = 44;

export const FEED_TEACH_COPY =
  'Swipe for the next reel · tap a product to inspect';

export const FEED_TEACH_STORAGE_KEY = 'mystash_home_feed_teach_dismissed';

export function productChipAccessibilityLabel(name: string, price: string): string {
  const title = name.trim() || 'Product';
  const amount = price.trim() || 'Price unavailable';
  return `${title}, ${amount}. View product.`;
}

export function feedReelAnnouncement(input: {
  title?: string | null;
  creatorName?: string | null;
}): string {
  const title = input.title?.trim() || '';
  const creator = input.creatorName?.trim() || '';
  if (title && creator) return `${title}. ${creator}.`;
  if (title) return title;
  if (creator) return creator;
  return '';
}

export function shouldShowFeedTeach(input: {
  dismissed: boolean | null;
  activeIndex: number;
  feedReady: boolean;
}): boolean {
  if (!input.feedReady) return false;
  if (input.dismissed !== false) return false;
  return input.activeIndex === 0;
}

/** Extra hitSlop on each side so a visual control meets the 44pt minimum. */
export function hitSlopToMinTarget(visualSize: number, min = FEED_MIN_HIT_TARGET): number {
  if (!(visualSize > 0)) return Math.ceil(min / 2);
  return Math.max(0, Math.ceil((min - visualSize) / 2));
}

export function feedThumbnailFadeMs(input: {
  reduceMotion: boolean;
  normalMs: number;
  reducedMs: number;
}): number {
  if (input.reduceMotion) return Math.max(0, input.reducedMs);
  return Math.max(0, input.normalMs);
}
