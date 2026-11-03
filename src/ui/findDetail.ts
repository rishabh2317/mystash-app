import type { FindScreenDetail } from '@/src/services/findClient';
import type { ReviewProduct } from '@/src/services/shareReviewApi';
export type FindDetailRow = { key: string; title: string; subtitle: string; image: string | null; saved?: boolean; removed?: boolean;
  placeId?:string|null;
  openProductId?: string | null; membership?: { kind: 'products' | 'places' | 'suggestion'; id: string; identity?: string; candidate?: string };
  candidate?: { sourceId: string; key: string } };
export function findDetailRows(detail: FindScreenDetail, options: ReviewProduct[] = []): FindDetailRow[] {
  const rows: FindDetailRow[] = [], identities = new Set<string>();
  for (const product of detail.products) {
    if (product.identityKey && identities.has(product.identityKey)) continue;
    if (product.identityKey) identities.add(product.identityKey);
    rows.push({ key: `product:${product.id}`, title: product.title, image: product.imageUrl,
      subtitle: product.identityKey ? product.saved ? 'In My Stash' : product.removed ? 'Removed from My Stash' : 'Automatic saving is pending' : product.matchKind === 'similar' ? 'No exact match. Similar options may be available.' : 'Not identified confidently',
      saved: product.saved, removed: product.removed, openProductId: product.catalogProductId ?? product.discoveredProductId,
      ...(product.identityKey ? { membership: { kind: 'products' as const, id: product.id, identity: product.identityKey } } : {}) });
  }
  for (const selected of detail.savedSuggestions) {
    if (identities.has(selected.identityKey)) continue; identities.add(selected.identityKey);
    rows.push({ key: `selected:${selected.sourceProductId}:${selected.candidateKey}`, title: selected.title, image: selected.imageUrl,
      subtitle: `Similar product · ${selected.saved ? 'In My Stash' : selected.removed ? 'Removed from My Stash' : 'Saving needs attention'}`,
      saved: selected.saved, removed: selected.removed, openProductId: selected.identityKey.slice(2),
      ...({ membership: { kind: 'suggestion' as const, id: selected.sourceProductId, identity: selected.identityKey, candidate: selected.candidateKey } }) });
  }
  for (const place of detail.places) rows.push({ key: `place:${place.id}`, title: place.name, image: null,placeId:place.placeId,
    subtitle: [place.resolution === 'resolved' ? 'Place identified' : 'Unverified place', [place.locality,place.city].filter(Boolean).join(', '), place.saved ? 'In My Stash' : place.removed ? 'Removed from My Stash' : 'Automatic saving is pending'].filter(Boolean).join(' · '),
    saved: place.saved, removed: place.removed, ...({ membership: { kind: 'places' as const, id: place.id } }) });
  for (const product of options) for (const candidate of product.assessment?.suggestions ?? []) {
    if (product.reviews.some(review => review.candidate_key === candidate.key && ['accepted','dismissed'].includes(review.state))) continue;
    rows.push({ key: `option:${product.sourceProductId}:${candidate.key}`, title: candidate.title, image: candidate.image,
      subtitle: 'Similar product · Save only if it’s useful to you', candidate: { sourceId: product.sourceProductId, key: candidate.key } });
  }
  return rows;
}
