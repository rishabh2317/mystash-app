/** Geography is context, not a venue. No city/country name lists or extra AI calls. */
export type PlaceClassificationInput = {
  name?: string; extractedName?: string; category?: string | null;
  city?: string | null; locality?: string | null; region?: string | null; country?: string | null;
  evidence?: Record<string, unknown>; types?: string[];
};
export const foldPlace = (s: string | null | undefined): string => (s ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const ADMIN = /^(?:country|continent|state|province|city|town|village|district|county|municipality|locality|sublocality(?: level \d+)?|neighborhood|postal town|postal code|administrative area(?: level \d+)?|political|geography|administrative geography)$/;
// ISO display names come from ICU, not a maintained geographic-name blacklist.
const countryNames = new Set<string>();
const displayNames = new Intl.DisplayNames(['en'], {type:'region',fallback:'none'});
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++) {
  const name=displayNames.of(String.fromCharCode(a,b));if(name)countryNames.add(foldPlace(name));
}
const VENUE = /\b(?:palace|gate|tower|landmark|attraction|monument|park|beach|hills?|mountain|lake|waterfall|forest|island|temple|museum|garden|reserve|sanctuary|cafe|restaurant|hotel|resort|stadium|airport)\b/;
export function classifyPlace(input: PlaceClassificationInput): 'geography' | 'destination' | 'unknown' {
  const name = foldPlace(input.name ?? input.extractedName), category = foldPlace(input.category);
  const kind = input.evidence?.entityKind;
  // Raw provider types are stronger than model text. A park can also be political.
  const types = (input.types ?? []).map(foldPlace);
  if (types.some(t => !ADMIN.test(t) && !['geocode','point of interest','establishment','premise'].includes(t))) return 'destination';
  if (types.some(t => ADMIN.test(t))) return 'geography';
  if (kind === 'administrative_geography' || ADMIN.test(category)) return 'geography';
  if (kind === 'venue' || kind === 'natural_destination' || VENUE.test(name) || VENUE.test(category)) return 'destination';
  if (countryNames.has(name)) return 'geography';
  if (name && [input.city,input.locality,input.region,input.country].some(value => foldPlace(value) === name)) return 'geography';
  return 'unknown';
}
export const isGeographyOnly = (input: PlaceClassificationInput): boolean => classifyPlace(input) === 'geography';
