/** Display taxonomy only: exact existing labels/types, never name-based inference. */
export const PLACE_CATEGORIES = [
  { key: 'restaurants', title: 'Restaurants', labels: ['restaurant', 'restaurants', 'dining', 'fine dining restaurant', 'fast food restaurant'] },
  { key: 'cafes', title: 'Cafés', labels: ['cafe', 'cafes', 'café', 'cafés', 'coffee shop'] },
  { key: 'hotels', title: 'Hotels', labels: ['hotel', 'hotels', 'resort hotel', 'motel', 'hostel'] },
  { key: 'stays', title: 'Stays', labels: ['accommodation', 'lodging', 'guest house', 'homestay', 'bed and breakfast'] },
  { key: 'attractions', title: 'Attractions', labels: ['attraction', 'attractions', 'tourist attraction', 'historical landmark', 'landmark', 'museum', 'monument', 'national park', 'amusement park'] },
  { key: 'shopping', title: 'Shopping', labels: ['shopping mall', 'shopping', 'mall', 'store', 'department store', 'shopping center', 'shopping centre'] },
  { key: 'destinations', title: 'Destinations', labels: ['city', 'town', 'region', 'country'] },
  { key: 'other', title: 'Other', labels: [] },
] as const;
export type PlaceCategoryKey = typeof PLACE_CATEGORIES[number]['key'];

export function normalizedPlaceCategory(raw: string | null | undefined): { key: PlaceCategoryKey; title: string } {
  const label = (raw ?? '').normalize('NFKC').toLowerCase().replace(/_/g, ' ').trim().replace(/\s+/g, ' ');
  const category = PLACE_CATEGORIES.find(c => (c.labels as readonly string[]).includes(label)) ?? PLACE_CATEGORIES[PLACE_CATEGORIES.length - 1];
  return { key: category.key, title: category.title };
}
