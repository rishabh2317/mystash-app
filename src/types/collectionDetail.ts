import type { CatalogProductViewModel } from '@/src/types/catalogProduct';

export type CollectionMediaPlatform = 'youtube' | 'instagram' | 'unknown';

export type CollectionMediaViewModel = {
  platform: CollectionMediaPlatform;
  sourceUrl: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
};

/** Full Collection browse page input — canonical Collection experience. */
export type CollectionDetailViewModel = {
  collectionId: string;
  slug: string;
  title: string | null;
  caption: string | null;
  heroThumbnailUrl: string | null;
  qualityScore: number | null;
  publishedAt: string | null;
  creator: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  counters: {
    views: number;
    saves: number;
  };
  primaryMedia: CollectionMediaViewModel | null;
  products: CatalogProductViewModel[];
};
