import type { PlaceSearchAttempt } from './decidePlaceMention';
import type { PlaceSearchCandidate } from './placeIdentityMatch';
import { PLACE_SEARCH_CANDIDATE_CAP, type PlaceSearchProvider } from './PlaceSearchProvider';

export const GOOGLE_PLACES_PROVIDER = 'google';
export const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
export const GOOGLE_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.googleMapsUri',
  'places.addressComponents',
].join(',');

const SKIP_CATEGORY_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'premise',
  'geocode',
  'political',
]);

export type PlaceSearchFetch = (url: string, init: RequestInit) => Promise<Response>;

type AddressComponent = {
  longText?: unknown;
  types?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function componentText(components: AddressComponent[], ...types: string[]): string | null {
  for (const type of types) {
    const hit = components.find(
      (component) => Array.isArray(component.types) && component.types.includes(type),
    );
    const value = text(hit?.longText);
    if (value) return value;
  }
  return null;
}

function placeId(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return raw.startsWith('places/') ? raw.slice('places/'.length) : raw;
}

function finiteCoord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function categoryFromTypes(types: unknown): string | null {
  if (!Array.isArray(types)) return null;
  for (const type of types) {
    if (typeof type !== 'string') continue;
    const normalized = type.trim().toLowerCase();
    if (!normalized || SKIP_CATEGORY_TYPES.has(normalized)) continue;
    return normalized.replace(/_/g, ' ');
  }
  return null;
}

/** Maps a Places Text Search (New) body into matcher candidates. Drops rows with no id or name. */
export function mapGooglePlacesTextSearchBody(body: unknown): PlaceSearchCandidate[] {
  if (!body || typeof body !== 'object') return [];
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];
  const candidates: PlaceSearchCandidate[] = [];
  for (const place of places) {
    if (!place || typeof place !== 'object') continue;
    const row = place as {
      id?: unknown;
      displayName?: { text?: unknown };
      formattedAddress?: unknown;
      location?: { latitude?: unknown; longitude?: unknown };
      types?: unknown;
      googleMapsUri?: unknown;
      addressComponents?: unknown;
    };
    const providerPlaceId = placeId(row.id);
    const name = text(row.displayName?.text);
    if (!providerPlaceId || !name) continue;
    const components = Array.isArray(row.addressComponents)
      ? (row.addressComponents as AddressComponent[])
      : [];
    candidates.push({
      providerPlaceId,
      name,
      locality: componentText(components, 'neighborhood', 'sublocality', 'sublocality_level_1'),
      city: componentText(components, 'locality', 'postal_town'),
      region: componentText(components, 'administrative_area_level_1'),
      country: componentText(components, 'country'),
      category: categoryFromTypes(row.types),
      formattedAddress: text(row.formattedAddress),
      latitude: finiteCoord(row.location?.latitude),
      longitude: finiteCoord(row.location?.longitude),
      mapsUrl: text(row.googleMapsUri),
    });
    if (candidates.length >= PLACE_SEARCH_CANDIDATE_CAP) break;
  }
  return candidates;
}

/**
 * Google Places Text Search (New). Not Serper, and not the product PDP search.
 * A missing key or a non-OK response is provider_failed. Coordinates and place ids
 * are returned only when this response includes them.
 */
export class GooglePlacesTextSearchProvider implements PlaceSearchProvider {
  readonly name = GOOGLE_PLACES_PROVIDER;

  constructor(
    private readonly options: {
      apiKey?: string | null;
      fetchImpl?: PlaceSearchFetch;
    } = {},
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<PlaceSearchAttempt> {
    const textQuery = query.trim();
    const apiKey = this.options.apiKey?.trim();
    if (!textQuery || !apiKey || signal?.aborted) {
      return { ok: false, reason: 'provider_failed' };
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: PLACE_SEARCH_CANDIDATE_CAP,
        }),
      });
      if (!response.ok) return { ok: false, reason: 'provider_failed' };
      const body: unknown = await response.json();
      return { ok: true, candidates: mapGooglePlacesTextSearchBody(body) };
    } catch {
      return { ok: false, reason: 'provider_failed' };
    }
  }
}
