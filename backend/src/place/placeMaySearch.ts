import { placeNameIsSpecific, placeNameStem } from './placeNameIsSpecific';

/**
 * One-token chain names that are not a unique place.
 * A denylist constant, not a gazetteer.
 */
export const NON_DISTINCTIVE_PLACE_NAMES = new Set([
  'starbucks',
  'mcdonalds',
  'mcdonald',
  'subway',
  'kfc',
  'dunkin',
]);

export type PlaceMentionFields = {
  name: string;
  locality?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  mentionedAddress?: string | null;
  category?: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** Most specific stated location, ignoring empty fields. Address is used only when nothing finer was stated. */
export function statedPlaceLocation(input: PlaceMentionFields): string | null {
  for (const value of [input.locality, input.city, input.region, input.country, input.mentionedAddress]) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

function nonChainStem(name: string): string[] {
  return placeNameStem(name).filter((token) => !NON_DISTINCTIVE_PLACE_NAMES.has(token));
}

/**
 * Discovery gate for a mention that already survived placeNameIsSpecific.
 * A generic place type is not searched, even when a locality field is set.
 */
export function placeMaySearch(input: PlaceMentionFields): boolean {
  if (!placeNameIsSpecific(input.name)) return false;
  if (statedPlaceLocation(input)) return true;
  return nonChainStem(input.name).length >= 2;
}

/**
 * Provider query. Null when search is not allowed.
 * Name only, plus the most specific stated location. No commerce country.
 */
export function placeSearchQuery(input: PlaceMentionFields): string | null {
  if (!placeMaySearch(input)) return null;
  const name = clean(input.name);
  const location = statedPlaceLocation(input);
  if (!location) return name;
  if (name.toLowerCase().includes(location.toLowerCase())) return name;
  return `${name} ${location}`;
}
