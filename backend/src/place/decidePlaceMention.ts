import { classifyPlace, foldPlace, isGeographyOnly } from './placeClassification';
import { resolveLeadSearchDestination } from './placeDestination';
import { matchPlaceIdentity, type PlaceMatchDecision, type PlaceSearchCandidate } from './placeIdentityMatch';
import { NON_DISTINCTIVE_PLACE_NAMES, placeMaySearch, placeSearchQuery, type PlaceMentionFields } from './placeMaySearch';
import { placeNameIsSpecific } from './placeNameIsSpecific';

export type PlaceSearchAttempt =
  | { ok: true; candidates: PlaceSearchCandidate[] }
  | { ok: false; reason: 'provider_failed' };

export type PlaceMentionDecision =
  | { outcome: 'discarded'; reason: 'generic_place_type' | 'administrative_geography'; searched: boolean }
  | {
      outcome: 'unresolved';
      reason: 'name_not_distinctive' | 'no_results' | 'ambiguous' | 'locality_conflict' | 'category_conflict' | 'provider_failed';
      searched: boolean;
      query: string | null;
      destination: ReturnType<typeof resolveLeadSearchDestination>;
    }
  | { outcome: 'resolved'; providerPlaceId: string; searched: true; query: string };

function unresolved(
  input: PlaceMentionFields,
  reason: Extract<PlaceMentionDecision, { outcome: 'unresolved' }>['reason'],
  searched: boolean,
  query: string | null,
): PlaceMentionDecision {
  return {
    outcome: 'unresolved',
    reason,
    searched,
    query,
    destination: resolveLeadSearchDestination(input),
  };
}

/**
 * Specificity, then search eligibility, then identity match.
 * The search callback is not called for a generic name or a kept name that is not searchable.
 */
export async function decidePlaceMention(
  input: PlaceMentionFields,
  search: (query: string) => Promise<PlaceSearchAttempt>,
): Promise<PlaceMentionDecision> {
  if (isGeographyOnly(input)) return {outcome:'discarded',reason:'administrative_geography',searched:false};
  if (!placeNameIsSpecific(input.name)) {
    return { outcome: 'discarded', reason: 'generic_place_type', searched: false };
  }
  // A legacy/untyped single name needs a provider type before it can be
  // distinguished globally from a city. No gazetteer or second AI call.
  const needsClassification=classifyPlace(input)==='unknown'&&!NON_DISTINCTIVE_PLACE_NAMES.has(foldPlace(input.name));
  const query = placeSearchQuery(input)??(needsClassification?input.name.trim():null);
  if ((!placeMaySearch(input)&&!needsClassification) || !query) {
    return unresolved(input, 'name_not_distinctive', false, null);
  }

  let attempt: PlaceSearchAttempt;
  try {
    attempt = await search(query);
  } catch {
    return unresolved(input, 'provider_failed', true, query);
  }
  if (!attempt.ok) return unresolved(input, 'provider_failed', true, query);

  if (attempt.candidates.length && attempt.candidates.every(isGeographyOnly)) return {outcome:'discarded',reason:'administrative_geography',searched:true};
  const matched: PlaceMatchDecision = matchPlaceIdentity(input, attempt.candidates);
  if (matched.outcome === 'resolved') {
    return { outcome: 'resolved', providerPlaceId: matched.providerPlaceId, searched: true, query };
  }
  return unresolved(input, matched.reason, true, query);
}
