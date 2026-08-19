import type { CollectionViewModel } from '@/src/types/collection';

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
