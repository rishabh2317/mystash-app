import type { CollectionAggregateDto } from '@/src/types/collectionAggregate';

export type FeedCollectionCounters = {
  views: number;
  saves: number;
  shares: number;
};

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
  counters: FeedCollectionCounters;
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
    counters: {
      views: collection.viewsCount ?? 0,
      saves: collection.savesCount ?? 0,
      shares: collection.sharesCount ?? 0,
    },
  };
}
