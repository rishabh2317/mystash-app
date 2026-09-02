/**
 * In-memory Search → Reel handoff. Preserves collection order and pagination cursor
 * for the active typed Search session. Not persisted across app restarts.
 */

export type SearchReelCollectionRef = {
  collectionId: string;
  heroThumbnailUrl: string | null;
};

export type SearchReelSession = {
  query: string;
  /** Collection hits in Search ranking order (typed results only). */
  collections: SearchReelCollectionRef[];
  startCollectionId: string;
  nextCursor: string | null;
};

let activeSession: SearchReelSession | null = null;

export function setSearchReelSession(session: SearchReelSession): void {
  activeSession = {
    ...session,
    collections: session.collections.map((c) => ({ ...c })),
  };
}

export function getSearchReelSession(): SearchReelSession | null {
  return activeSession;
}

export function clearSearchReelSession(): void {
  activeSession = null;
}

/** Append newly paginated Collection ids (deduped, order preserved). */
export function appendSearchReelCollections(next: SearchReelCollectionRef[]): void {
  if (!activeSession || next.length === 0) return;
  const seen = new Set(activeSession.collections.map((c) => c.collectionId));
  for (const row of next) {
    const id = row.collectionId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    activeSession.collections.push({
      collectionId: id,
      heroThumbnailUrl: row.heroThumbnailUrl ?? null,
    });
  }
}

export function updateSearchReelCursor(nextCursor: string | null): void {
  if (!activeSession) return;
  activeSession.nextCursor = nextCursor;
}

export function searchReelCollectionIds(session: SearchReelSession): string[] {
  return session.collections.map((c) => c.collectionId);
}

export function initialSearchReelIndex(session: SearchReelSession, startCollectionId: string): number {
  const idx = session.collections.findIndex((c) => c.collectionId === startCollectionId);
  return idx >= 0 ? idx : 0;
}
