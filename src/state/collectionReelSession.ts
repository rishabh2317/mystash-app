export type CollectionReelRef = { collectionId: string; heroThumbnailUrl?: string | null };
export type CollectionReelSource = { kind: 'snapshot' } | { kind: 'creator'; creatorId: string } | { kind: 'saved' };
export type CollectionReelContext = {
  collections: readonly CollectionReelRef[];
  source?: CollectionReelSource;
  /** Empty string starts a creator's first page; null means the source is exhausted. */
  nextCursor?: string | null;
  ownerId?: string;
};
export type CollectionReelSession = {
  collections: { collectionId: string; heroThumbnailUrl: string | null }[];
  source: CollectionReelSource;
  startCollectionId: string;
  nextCursor: string | null;
  ownerId?: string;
};
const sessions = new Map<string, CollectionReelSession>();
let serial = 0;
export function mergeCollectionReelRefs(existing: readonly CollectionReelRef[], incoming: readonly CollectionReelRef[]) {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter(row => {
    const id = row.collectionId.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  }).map(row => ({ collectionId: row.collectionId.trim(), heroThumbnailUrl: row.heroThumbnailUrl ?? null }));
}
/** Separate handoffs keep nested reel navigation from replacing a previous source. */
export function createCollectionReelSession(startCollectionId: string, context: CollectionReelContext): string {
  const id = `reels-${++serial}`;
  sessions.set(id, { source: context.source ?? { kind: 'snapshot' }, startCollectionId,
    collections: mergeCollectionReelRefs(context.collections, [{ collectionId: startCollectionId }]),
    nextCursor: context.nextCursor ?? null, ownerId: context.ownerId });
  if (sessions.size > 12) sessions.delete(sessions.keys().next().value!);
  return id;
}
export const getCollectionReelSession = (id: string) => sessions.get(id) ?? null;

/** An extra copy of the first row lets the next swipe reach the start naturally. */
export function collectionReelLoopRows<T>(rows: readonly T[], nextCursor: string | null): T[] {
  return nextCursor === null && rows.length > 1 ? [...rows, rows[0]] : [...rows];
}
export function collectionReelLoopTarget(index: number, length: number, nextCursor: string | null): number | null {
  return length > 1 && nextCursor === null && index === length ? 0 : null;
}
