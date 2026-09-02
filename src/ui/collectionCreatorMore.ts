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
