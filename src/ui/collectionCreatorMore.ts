import type { CollectionViewModel } from '@/src/types/collection';

export const CREATOR_MORE_COLLECTIONS_PREVIEW = 6;

export function filterCreatorCollectionsPreview(
  collections: CollectionViewModel[],
  currentCollectionId: string,
  limit = CREATOR_MORE_COLLECTIONS_PREVIEW,
): CollectionViewModel[] {
  const current = currentCollectionId.trim();
  return collections.filter((c) => c.collectionId.trim() !== current).slice(0, limit);
}

export function shouldShowCreatorCollectionsViewAll(input: {
  totalOthers: number;
  previewLimit: number;
  hasNextCursor: boolean;
  creatorUsername: string | null | undefined;
}): boolean {
  if (!input.creatorUsername?.trim()) return false;
  return input.hasNextCursor || input.totalOthers > input.previewLimit;
}

/** First other Collection from this creator — used as the Home play-chip destination. */
export type CreatorMoreReelTarget = {
  collectionId: string;
  title: string;
};

export function creatorMoreReelTarget(
  collections: CollectionViewModel[],
  currentCollectionId: string,
): CreatorMoreReelTarget | null {
  const next = filterCreatorCollectionsPreview(collections, currentCollectionId, 1)[0];
  if (!next) return null;
  const title = next.title?.trim() || next.slug.trim();
  if (!next.collectionId.trim() || !title) return null;
  return { collectionId: next.collectionId, title };
}
