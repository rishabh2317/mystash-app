import type { PlaceMentionFields } from './placeMaySearch';

export type PlaceDestinationFields = {
  name: string;
  locality?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  mentionedAddress?: string | null;
};

export type PlaceSearchDestination = {
  kind: 'google_search';
  query: string;
  url: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function locationParts(input: PlaceDestinationFields): string[] {
  return [input.name, input.locality, input.city, input.region, input.country, input.mentionedAddress]
    .map(clean)
    .filter(Boolean);
}

/**
 * V1 destination for a canonical place or an unresolved lead.
 * Uses only name plus location fields that exist. Does not read provider place id, coordinates, or a Maps URI.
 */
export function resolvePlaceDestination(input: PlaceDestinationFields): PlaceSearchDestination {
  const query = locationParts(input).join(' ');
  return {
    kind: 'google_search',
    query,
    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  };
}

/** Unresolved lead: extracted fields only. Same projection as a resolved place. */
export function resolveLeadSearchDestination(input: PlaceMentionFields): PlaceSearchDestination {
  return resolvePlaceDestination(input);
}

export function placeLocationLabel(input: Omit<PlaceDestinationFields, 'name'>): string | null {
  const query = [input.locality, input.city, input.region, input.country, input.mentionedAddress]
    .map(clean)
    .filter(Boolean)
    .join(', ');
  return query.length > 0 ? query : null;
}
