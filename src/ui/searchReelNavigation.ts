import type { CollectionViewModel } from '@/src/types/collection';
import type { SearchResultCard } from '@/src/services/searchApi';
import {
  initialSearchReelIndex,
  type SearchReelCollectionRef,
  type SearchReelSession,
  setSearchReelSession,
} from '@/src/state/searchReelSession';

export const SEARCH_REEL_VIEW_SURFACE = 'search_reel' as const;

export function searchReelPath(collectionId: string): string {
  return `/reel/search/${encodeURIComponent(collectionId.trim())}`;
}

export function collectionRefsFromViewModels(
  collections: CollectionViewModel[],
): SearchReelCollectionRef[] {
  return collections.map((c) => ({
    collectionId: c.collectionId,
    heroThumbnailUrl: c.heroThumbnailUrl ?? null,
  }));
}

/** Extract Collection ids from a Search page in API order (deduped against existing). */
export function collectionIdsFromSearchResults(
  results: SearchResultCard[],
  existing: readonly string[],
): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const row of results) {
    if (row.entityType !== 'collection') continue;
    const id = row.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function collectionRefsFromSearchResults(
  results: SearchResultCard[],
  existing: readonly SearchReelCollectionRef[],
): SearchReelCollectionRef[] {
  const seen = new Set(existing.map((c) => c.collectionId));
  const out = [...existing];
  for (const row of results) {
    if (row.entityType !== 'collection') continue;
    const id = row.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      collectionId: id,
      heroThumbnailUrl: row.primaryMediaRef ?? row.imageRef ?? null,
    });
  }
  return out;
}

export function beginSearchReelSession(input: {
  query: string;
  collections: CollectionViewModel[];
  startCollectionId: string;
  nextCursor: string | null;
}): SearchReelSession {
  const session: SearchReelSession = {
    query: input.query.trim(),
    collections: collectionRefsFromViewModels(input.collections),
    startCollectionId: input.startCollectionId.trim(),
    nextCursor: input.nextCursor,
  };
  setSearchReelSession(session);
  return session;
}

export function shouldOpenSearchReelFeed(input: {
  hasActiveQuery: boolean;
  collections: CollectionViewModel[];
  tappedCollectionId: string;
}): boolean {
  if (!input.hasActiveQuery) return false;
  if (input.collections.length === 0) return false;
  return input.collections.some((c) => c.collectionId === input.tappedCollectionId);
}

export { initialSearchReelIndex };
