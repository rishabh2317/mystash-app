export type CollectionViewModel = {
  collectionId: string;
  slug: string;
  title: string | null;
  heroThumbnailUrl: string | null;
  productCount: number;
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
};
