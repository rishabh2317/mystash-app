import type { CollectionAggregateDto } from '@/src/types/collectionAggregate';

/** Slim Collection identity for Home Follow/Save/Share — not a catalog hydrate. */
export type FeedCollectionContext = {
  collectionId: string;
  title: string | null;
  creator: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

export function mapAggregateToFeedCollectionContext(
  aggregate: CollectionAggregateDto,
): FeedCollectionContext {
  const { collection } = aggregate;
  const username = collection.creatorUsername?.trim().replace(/^@/, '') || null;
  return {
    collectionId: collection.id,
    title: collection.title,
    creator: {
      id: collection.creatorId,
      username,
      displayName: collection.creatorName?.trim() || null,
      avatarUrl: collection.creatorAvatar?.trim() || null,
    },
  };
}
