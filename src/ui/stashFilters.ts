/** Shared presentation rules. All is a null key, so it cannot collide with a real category. */
export const STASH_FILTER_COPY = { all: 'All', recentlyStashed: 'Recently stashed',
  products: 'Filter recent products', places: 'Filter recent places' } as const;

const CATEGORY_ICONS = {
  restaurants: 'restaurant-outline', cafes: 'cafe-outline', hotels: 'bed-outline', stays: 'home-outline',
  attractions: 'camera-outline', shopping: 'bag-handle-outline', destinations: 'earth-outline', other: 'pricetag-outline',
  electronics: 'phone-portrait-outline', fashion: 'shirt-outline', beauty: 'sparkles-outline',
  home: 'home-outline', sports: 'fitness-outline', books: 'book-outline', food: 'restaurant-outline',
} as const;
export type StashFilterIcon = typeof CATEGORY_ICONS[keyof typeof CATEGORY_ICONS] | 'grid-outline';
export type StashFilterOption = { key: string | null; label: string; icon: StashFilterIcon };

export function stashFilterOptions(categories: readonly { key: string; title: string }[]): StashFilterOption[] {
  const unique = [...new Map(categories.map(category => [category.key, category])).values()];
  return [{ key: null, label: STASH_FILTER_COPY.all, icon: 'grid-outline' }, ...unique.map(category => ({
    key: category.key, label: category.title,
    icon: CATEGORY_ICONS[category.key.toLowerCase() as keyof typeof CATEGORY_ICONS] ?? 'pricetag-outline' as const,
  }))];
}

export function activeStashFilter(options: readonly StashFilterOption[], selected: string | null): string | null {
  return options.some(option => option.key === selected) ? selected : null;
}

/** Filter the complete fetched dataset, never the eight-item discovery preview.
 * Stable newest-first ordering uses real timestamps; undated legacy entries retain
 * their API order after dated entries. Source records are not mutated. */
export function filterRecentStash<T extends { addedAt?: string }>(
  items: readonly T[], selected: string | null, categoryKey: (item: T) => string,
): T[] {
  return items.map((item, index) => ({ item, index, time: Date.parse(item.addedAt ?? '') }))
    .filter(row => selected === null || categoryKey(row.item) === selected)
    .sort((a, b) => {
      const aTime = Number.isFinite(a.time) ? a.time : -Infinity;
      const bTime = Number.isFinite(b.time) ? b.time : -Infinity;
      return (aTime === bTime ? 0 : aTime > bTime ? -1 : 1) || a.index - b.index;
    }).map(row => row.item);
}
