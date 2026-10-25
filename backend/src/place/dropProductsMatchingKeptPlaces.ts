import { normalizeProductIdentityTokens } from '../product-intelligence/normalizer/ProductIdentityCanonicalizer';
import { isIdentityFillerToken } from '../product-intelligence/search/productIdentityCompatibility';
import type { ExtractedPlaceMention } from './parseReasonerPayload';
import { PLACE_TYPE_TOKENS, placeNameIsSpecific, placeNameStem } from './placeNameIsSpecific';

/**
 * Location words that are not venue identity. Not a gazetteer.
 * Tokens from a mention's locality/city/region/country/address are also stripped.
 */
const LOCATION_HINT_TOKENS = new Set([
  'sector',
  'street',
  'road',
  'avenue',
  'airport',
  'district',
  'block',
  'phase',
  'nagar',
  'village',
  'town',
  'area',
  'colony',
  'extension',
  'highway',
  'layout',
  'cross',
]);

/**
 * Venue flavour words. They do not make a product a separate SKU.
 * They are not used to discard a product on their own.
 */
const VENUE_DESCRIPTOR_TOKENS = new Set([
  'pod',
  'pods',
  'capsule',
  'inn',
  'lodge',
  'villa',
  'stay',
  'house',
  'home',
  'tower',
  'garden',
  'square',
  'palace',
  'japanese',
  'italian',
  'french',
  'indian',
  'chinese',
  'korean',
  'thai',
  'mexican',
  'american',
  'english',
  'luxury',
  'boutique',
]);

/**
 * Purchasable-product tokens. Presence means KEEP — the row is merchandise/SKU,
 * not the venue itself. Do not treat hotel/restaurant/cafe as this set.
 */
const PRODUCT_SKU_TOKENS = new Set([
  'shirt',
  'shirts',
  'tee',
  'tees',
  'tshirt',
  'hoodie',
  'sweater',
  'jacket',
  'mug',
  'mugs',
  'merch',
  'merchandise',
  'bottle',
  'cap',
  'hat',
  'dress',
  'jeans',
  'sneaker',
  'sneakers',
  'shoe',
  'shoes',
  'headphone',
  'headphones',
  'earbud',
  'earbuds',
  'watch',
  'bag',
  'backpack',
  'perfume',
  'lipstick',
  'camera',
  'laptop',
  'phone',
  'bike',
  'bicycle',
  'charger',
  'cable',
  'case',
  'cover',
  'kit',
  'snack',
  'chocolate',
]);

export type PlaceNameFields = Pick<
  ExtractedPlaceMention,
  'name' | 'locality' | 'city' | 'region' | 'country' | 'mentionedAddress'
>;

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(
    normalizeProductIdentityTokens(value)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 3 && !isIdentityFillerToken(token)),
  );
}

function locationTokens(place: PlaceNameFields): Set<string> {
  const out = new Set<string>();
  for (const token of [
    ...tokenSet(place.locality),
    ...tokenSet(place.city),
    ...tokenSet(place.region),
    ...tokenSet(place.country),
    ...tokenSet(place.mentionedAddress),
  ]) {
    out.add(token);
  }
  return out;
}

function venueCore(name: string, location: Set<string>): Set<string> {
  const core = new Set<string>();
  for (const token of placeNameStem(name)) {
    if (location.has(token) || LOCATION_HINT_TOKENS.has(token) || VENUE_DESCRIPTOR_TOKENS.has(token)) {
      continue;
    }
    core.add(token);
  }
  return core;
}

function hasPurchasableSkuToken(name: string): boolean {
  for (const token of normalizeProductIdentityTokens(name).map((item) => item.toLowerCase())) {
    if (PRODUCT_SKU_TOKENS.has(token)) return true;
    if (/\d/.test(token)) return true;
  }
  return false;
}

function isSubset(inner: Set<string>, outer: Set<string>): boolean {
  for (const token of inner) {
    if (!outer.has(token)) return false;
  }
  return inner.size > 0;
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || left.size !== right.size) return false;
  return isSubset(left, right);
}

function ignorableForVenue(token: string, location: Set<string>): boolean {
  return (
    location.has(token) ||
    LOCATION_HINT_TOKENS.has(token) ||
    VENUE_DESCRIPTOR_TOKENS.has(token) ||
    PLACE_TYPE_TOKENS.has(token)
  );
}

/**
 * True when the product name is the same venue as a kept place.
 * Uncertain identity returns false (KEEP the product).
 */
export function productIsKeptPlace(productName: string, place: PlaceNameFields): boolean {
  const name = productName.trim();
  if (!name || !placeNameIsSpecific(place.name)) return false;
  if (hasPurchasableSkuToken(name)) return false;

  const location = locationTokens(place);
  const placeCore = venueCore(place.name, location);
  const productCore = venueCore(name, location);
  if (placeCore.size === 0 || productCore.size === 0) return false;
  if (setsEqual(placeCore, productCore)) return true;

  const extrasOnProduct = [...productCore].filter((token) => !placeCore.has(token));
  const extrasOnPlace = [...placeCore].filter((token) => !productCore.has(token));
  if (extrasOnProduct.every((token) => ignorableForVenue(token, location)) && isSubset(placeCore, productCore)) {
    return true;
  }
  if (extrasOnPlace.every((token) => ignorableForVenue(token, location)) && isSubset(productCore, placeCore)) {
    return true;
  }
  return false;
}

/**
 * User-import only. Drops a product only when it matches a kept specific place.
 * Generic place-type names are not kept and never remove a product.
 */
export function dropProductsMatchingKeptPlaces<T extends { name?: string | null }>(
  products: T[],
  places: PlaceNameFields[],
): T[] {
  const kept = places.filter((place) => placeNameIsSpecific(place.name));
  if (kept.length === 0) return products;
  return products.filter((product) => {
    const name = product.name?.trim();
    if (!name) return true;
    return !kept.some((place) => productIsKeptPlace(name, place));
  });
}
