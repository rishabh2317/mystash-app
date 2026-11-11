import type { FindScreenDetail, FindItem } from '@/src/services/findClient';
import type { ReviewProduct } from '@/src/services/shareReviewApi';
import type { PlaceStashItem } from '@/src/types/placeStash';
import { safeFindUrl } from './find';

/** Only use a Stash destination tied to this source or the same canonical place. */
export function findPlaceDestination(items: PlaceStashItem[], importId: string, sourcePlaceId: string, placeId?: string | null): {url:string;id:string;kind:PlaceStashItem['kind']} | null {
  const item=items.find(place=>place.sources?.some(source=>source.userImportId===importId && source.contentSourcePlaceId===sourcePlaceId) || Boolean(placeId && place.kind==='resolved' && place.id===placeId));
  const url=safeFindUrl(item?.destination.url);
  return item && url ? {url,id:item.id,kind:item.kind} : null;
}
export type FindDetailStatusTone = 'queued' | 'working' | 'warning' | 'error' | 'success' | 'empty';
export function findDetailStatus(item: FindItem): {label:string;message:string;icon:'checkmark-circle-outline'|'sparkles-outline'|'alert-circle-outline';tone:FindDetailStatusTone} {
  const o=item.outcome, hasResults=o.foundProducts+o.foundPlaces>0, saved=o.savedProducts+o.savedPlaces>0;
  if(o.delayed) return {label:'This one’s taking a little longer',message:'Your Find is still being worked on.',icon:'sparkles-outline',tone:'warning'};
  if(o.stashSync==='failed') return {label:'We hit a snag',message:'Your results are here, but saving needs another try.',icon:'alert-circle-outline',tone:'error'};
  if(o.extractionActive) return hasResults ? {label:'Look what we’ve spotted!',message:'Your first finds are here. We’re still looking for more.',icon:'sparkles-outline',tone:'working'} : {label:'Let’s see what we can find…',message:'We’re looking for products and places that caught your eye.',icon:'sparkles-outline',tone:'working'};
  if(o.result==='partial') return {label:'Some finds are here',message:'Part of this Find could not finish. Available results remain below.',icon:'alert-circle-outline',tone:'warning'};
  if(o.result==='failed'||o.stashSync==='unavailable') return {label:'We hit a snag',message:'We couldn’t finish this Find. Any available results remain below.',icon:'alert-circle-outline',tone:'error'};
  if(o.result==='pending'&&!hasResults) return {label:'We’ve got your Find!',message:'It’s safely queued and ready for its turn.',icon:'sparkles-outline',tone:'queued'};
  if(o.stashSync==='pending') return {label:'Getting your finds ready',message:'Adding confirmed matches to your Stash.',icon:'sparkles-outline',tone:'working'};
  if(o.result==='empty'||!hasResults) return {label:'Nothing we could pin down',message:'We couldn’t confidently identify a match this time.',icon:'sparkles-outline',tone:'empty'};
  return {label:'Look what we found!',message:saved?'Your saved finds are ready in My Stash.':'Your discoveries are shown below.',icon:'checkmark-circle-outline',tone:'success'};
}
export function canRetryFindSaving(item: FindItem): boolean { return item.outcome.stashSync === 'failed' && item.outcome.canRetrySaving; }
export type FindDetailRow = { key: string; title: string; subtitle: string; image: string | null; saved?: boolean; removed?: boolean;
  matchLabel?: 'Exact match' | 'Possible match' | 'Similar styles';
  placeId?:string|null;
  catalogProductId?: string | null;
  openProductId?: string | null; membership?: { kind: 'products' | 'places' | 'suggestion'; id: string; identity?: string; candidate?: string };
  candidate?: { sourceId: string; key: string } };
export function findDetailRows(detail: FindScreenDetail, options: ReviewProduct[] = []): FindDetailRow[] {
  const rows: FindDetailRow[] = [], identities = new Set<string>();
  for (const product of detail.products) {
    if (product.identityKey && identities.has(product.identityKey)) continue;
    if (product.identityKey) identities.add(product.identityKey);
    rows.push({ key: `product:${product.id}`, title: product.title, image: product.imageUrl,
      matchLabel: product.identityKey ? 'Exact match' : product.matchKind === 'possible' ? 'Possible match' : undefined,
      subtitle: product.identityKey ? product.saved ? 'In My Stash' : product.removed ? 'Removed from My Stash' : 'Automatic saving is pending' : product.matchKind === 'possible' ? 'Exact style not confirmed. Not automatically saved.' : product.matchKind === 'similar' ? 'No exact match. Similar options may be available.' : 'Not identified confidently',
      saved: product.saved, removed: product.removed, catalogProductId: product.identityKey && product.matchKind === 'exact' ? product.catalogProductId : null, openProductId: product.identityKey ? product.catalogProductId ?? product.discoveredProductId : null,
      ...(product.identityKey ? { membership: { kind: 'products' as const, id: product.id, identity: product.identityKey } } : {}) });
  }
  for (const selected of detail.savedSuggestions) {
    if (identities.has(selected.identityKey)) continue; identities.add(selected.identityKey);
    rows.push({ key: `selected:${selected.sourceProductId}:${selected.candidateKey}`, title: selected.title, image: selected.imageUrl,
      subtitle: `Similar product · ${selected.saved ? 'In My Stash' : selected.removed ? 'Removed from My Stash' : 'Saving needs attention'}`,
      saved: selected.saved, removed: selected.removed, catalogProductId: selected.identityKey.startsWith('c:') ? selected.identityKey.slice(2) : null, openProductId: selected.identityKey.slice(2),
      ...({ membership: { kind: 'suggestion' as const, id: selected.sourceProductId, identity: selected.identityKey, candidate: selected.candidateKey } }) });
  }
  for (const place of detail.places) rows.push({ key: `place:${place.id}`, title: place.name, image: null,placeId:place.resolution==='resolved'?place.placeId:null,
    subtitle: [place.resolution === 'resolved' ? 'Place identified' : 'Unverified place', [place.locality,place.city].filter(Boolean).join(', '), place.saved ? 'In My Stash' : place.removed ? 'Removed from My Stash' : 'Automatic saving is pending'].filter(Boolean).join(' · '),
    saved: place.saved, removed: place.removed, ...({ membership: { kind: 'places' as const, id: place.id } }) });
  for (const product of options) for (const candidate of product.assessment?.suggestions ?? []) {
    if (product.reviews.some(review => review.candidate_key === candidate.key && ['accepted','dismissed'].includes(review.state))) continue;
    rows.push({ key: `option:${product.sourceProductId}:${candidate.key}`, title: candidate.title, image: candidate.image,
      matchLabel: candidate.kind === 'possible' ? 'Possible match' : candidate.kind === 'similar_styles' ? 'Similar styles' : undefined,
      subtitle: candidate.kind === 'possible' ? 'Exact style not confirmed · Save if useful' : candidate.kind === 'similar_styles' ? 'Alternative, not confirmed in this video' : 'Similar product · Save only if it’s useful to you', candidate: { sourceId: product.sourceProductId, key: candidate.key } });
  }
  return rows;
}

/** Suggestions are never included in authoritative confirmed/saved outcome counts. */
export function findSuggestionCounts(detail: FindScreenDetail, options: ReviewProduct[]) {
  // Legacy outcome.foundProducts also includes explicitly accepted suggestions.
  // Detail contains the complete source product projection, not a paginated slice.
  const confirmed = new Set(detail.products.filter(p => p.identityKey && p.matchKind === 'exact').map(p => p.identityKey));
  return { confirmed: confirmed.size,
    selected: new Set(detail.savedSuggestions.filter(p => !confirmed.has(p.identityKey)).map(p => p.identityKey)).size,
    possible: detail.products.filter(p => !p.identityKey && p.matchKind === 'possible').length,
    styles: new Set(options.flatMap(p => (p.assessment?.suggestions ?? []).filter(s => s.kind === 'similar_styles' &&
      !p.reviews.some(r => r.candidate_key === s.key && ['accepted','dismissed'].includes(r.state))).map(s => s.key))).size };
}
