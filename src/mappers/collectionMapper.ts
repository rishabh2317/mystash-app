import type { CollectionViewModel } from '@/src/types/collection';
import type { CollectionAggregateDto } from '@/src/types/collectionAggregate';

type PublishedCollectionListItemDto = {
  id: string;
  slug: string;
  title: string | null;
  publishedAt: string | null;
  heroThumbnailUrl: string | null;
  productTagCount: number;
  creator: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  counters?: {
    views?: number;
    saves?: number;
  };
};

export function mapPublishedCollectionListItem(
  item: PublishedCollectionListItemDto,
): CollectionViewModel {
  return {
    collectionId: item.id,
    slug: item.slug,
    title: item.title,
    heroThumbnailUrl: item.heroThumbnailUrl,
    productCount: item.productTagCount ?? 0,
    publishedAt: item.publishedAt,
    creator: {
      id: item.creator.id,
      username: item.creator.username,
      displayName: item.creator.displayName,
      avatarUrl: item.creator.avatarUrl,
    },
    counters: {
      views: item.counters?.views ?? 0,
      saves: item.counters?.saves ?? 0,
    },
  };
}

/** Hydrate a saved-collection id from the existing aggregate DTO. */
export function mapAggregateToCollectionViewModel(
  aggregate: CollectionAggregateDto,
): CollectionViewModel {
  const { collection, tags } = aggregate;
  const productCount = tags.filter(
    (tag) => tag.includeInPublish && !tag.deletedAt,
  ).length;
  return {
    collectionId: collection.id,
    slug: collection.slug,
    title: collection.title,
    heroThumbnailUrl: collection.heroThumbnailUrl,
    productCount,
    publishedAt: collection.publishedAt,
    creator: {
      id: collection.creatorId,
      username: collection.creatorUsername,
      displayName: collection.creatorName,
      avatarUrl: collection.creatorAvatar,
    },
    counters: {
      views: collection.viewsCount ?? 0,
      saves: collection.savesCount ?? 0,
    },
  };
}
