import { normalizedPlaceAddress } from './placeMentionDedupe';
import { isGeographyOnly } from './placeClassification';
import { normalizeProductIdentityTokens } from '../product-intelligence/normalizer/ProductIdentityCanonicalizer';
import { NON_DISTINCTIVE_PLACE_NAMES, type PlaceMentionFields } from './placeMaySearch';
import { placeNameStem } from './placeNameIsSpecific';

export type PlaceSearchCandidate = {
  providerPlaceId: string;
  types?: string[];
  name: string;
  locality?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  category?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
};

export type PlaceMatchDecision =
  | { outcome: 'resolved'; providerPlaceId: string }
  | {
      outcome: 'unresolved';
      reason: 'no_results' | 'ambiguous' | 'locality_conflict' | 'category_conflict';
    };

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function tokens(value: string | null | undefined): string[] {
  return normalizeProductIdentityTokens(value)
    .map((token) => fold(token))
    .filter((token) => token.length >= 3);
}

function requiredNameTokens(name: string): string[] {
  const stem = placeNameStem(name).map((token) => fold(token));
  const specific = stem.filter((token) => !NON_DISTINCTIVE_PLACE_NAMES.has(token));
  if (specific.length > 0) return specific;
  return stem.filter((token) => NON_DISTINCTIVE_PLACE_NAMES.has(token));
}

function nameCompatible(hypothesisName: string, candidateName: string): boolean {
  const required = requiredNameTokens(hypothesisName);
  if (required.length === 0) return false;
  const haystack = new Set(tokens(candidateName));
  return required.every((token) => haystack.has(token));
}

function categoryTokens(value: string | null | undefined): string[] {
  return tokens(value).filter((token) => token.length >= 3);
}

function categoryConflicts(
  hypothesisCategory: string | null | undefined,
  candidateCategory: string | null | undefined,
): boolean {
  const left = categoryTokens(hypothesisCategory);
  const right = categoryTokens(candidateCategory);
  if (left.length === 0 || right.length === 0) return false;
  const leftSet = new Set(left);
  return right.every((token) => !leftSet.has(token));
}

function fieldConflicts(stated: string | null | undefined, candidateField: string | null | undefined): boolean {
  const expected = tokens(stated);
  if (expected.length === 0) return false;
  const actual = tokens(candidateField);
  if (actual.length === 0) return false;
  const actualSet = new Set(actual);
  return expected.every((token) => !actualSet.has(token));
}

function locationConflicts(hypothesis: PlaceMentionFields, candidate: PlaceSearchCandidate): boolean {
  const aliasMatch=(field:'locality'|'city'|'region'|'country')=>{
    const map=hypothesis.evidence?.locationAliases as Record<string,unknown>|undefined;
    const aliases=map && Array.isArray(map[field])?map[field] as unknown[]:[];
    return aliases.some(value=>typeof value==='string'&&!fieldConflicts(value,candidate[field]??candidate.formattedAddress));
  };
  if(hypothesis.mentionedAddress) {
    const expectedAddress=normalizedPlaceAddress(hypothesis.mentionedAddress).split(' | ')[0];
    const numbers=expectedAddress.match(/\b\d+[a-z]?\b/g)??[];
    if(numbers.length) {
      if(!candidate.formattedAddress)return true;
      const actualAddress=normalizedPlaceAddress(candidate.formattedAddress).split(' | ')[0];
      const actual=new Set(actualAddress.split(' '));
      if(numbers.some(number=>!actual.has(number)))return true;
      const context=new Set(normalizedPlaceAddress([hypothesis.name,hypothesis.locality,hypothesis.city,hypothesis.region,hypothesis.country].filter(Boolean).join(' ')).split(' '));
      const street=expectedAddress.split(' ').filter(token=>token.length>=2&&!/\d/.test(token)&&!context.has(token)&&!['number','road','street','avenue','boulevard','unit','floor','apartment','building','sector'].includes(token));
      if(street.some(token=>!actual.has(token)))return true;
    }
  }
  const branch=typeof hypothesis.evidence?.branch==='string'?hypothesis.evidence.branch:null;
  if(branch && (!candidate.formattedAddress&&!candidate.locality || fieldConflicts(branch,candidate.formattedAddress??candidate.locality)))return true;
  return (
    !aliasMatch('locality') && fieldConflicts(hypothesis.locality, candidate.locality ?? candidate.formattedAddress) ||
    !aliasMatch('city') && fieldConflicts(hypothesis.city, candidate.city ?? candidate.formattedAddress) ||
    !aliasMatch('region') && fieldConflicts(hypothesis.region, candidate.region ?? candidate.formattedAddress) ||
    !aliasMatch('country') && fieldConflicts(hypothesis.country, candidate.country ?? candidate.formattedAddress)
  );
}

/**
 * Canonical identity gate. Exactly one name-compatible candidate that does not
 * contradict a stated location may resolve. Fame, distance, and commerce country
 * are not inputs.
 */
export function matchPlaceIdentity(
  hypothesis: PlaceMentionFields,
  candidates: PlaceSearchCandidate[],
): PlaceMatchDecision {
  const unique = new Map<string, PlaceSearchCandidate>();
  for (const candidate of candidates) {
    if (!candidate.providerPlaceId.trim() || isGeographyOnly(candidate)) continue;
    if (!unique.has(candidate.providerPlaceId)) unique.set(candidate.providerPlaceId, candidate);
  }
  const named = [...unique.values()].filter((candidate) => nameCompatible(hypothesis.name, candidate.name));
  if (named.length === 0) return { outcome: 'unresolved', reason: 'no_results' };

  const categoryOk = named.filter((candidate) => !categoryConflicts(hypothesis.category, candidate.category));
  if (categoryOk.length === 0) return { outcome: 'unresolved', reason: 'category_conflict' };

  const locationOk = categoryOk.filter((candidate) => !locationConflicts(hypothesis, candidate));
  if (locationOk.length === 0) return { outcome: 'unresolved', reason: 'locality_conflict' };
  if (locationOk.length > 1) return { outcome: 'unresolved', reason: 'ambiguous' };
  return { outcome: 'resolved', providerPlaceId: locationOk[0]!.providerPlaceId };
}
