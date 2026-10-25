import { isIdentityFillerToken } from '../product-intelligence/search/productIdentityCompatibility';
import { normalizeProductIdentityTokens } from '../product-intelligence/normalizer/ProductIdentityCanonicalizer';

/**
 * Place-category nouns. A name made only of these is not a place.
 * Not a gazetteer and not a chain-brand list.
 */
export const PLACE_TYPE_TOKENS = new Set([
  'cafe',
  'coffee',
  'restaurant',
  'hotel',
  'beach',
  'bar',
  'pub',
  'park',
  'resort',
  'hostel',
  'shop',
  'store',
  'mall',
  'museum',
  'club',
  'lounge',
  'bakery',
  'spa',
  'diner',
  'attraction',
  'temple',
]);

/** Tokens that make a name a specific place rather than a category. */
export function placeNameStem(name: string): string[] {
  return normalizeProductIdentityTokens(name)
    .map((token) => token.toLowerCase())
    .filter((token) => !isIdentityFillerToken(token))
    .filter((token) => !PLACE_TYPE_TOKENS.has(token))
    .filter((token) => token.length >= 3);
}

/**
 * True when the extracted name itself contains a specific token.
 * Locality, city, and address fields are not considered.
 */
export function placeNameIsSpecific(name: string): boolean {
  return placeNameStem(name).length >= 1;
}
