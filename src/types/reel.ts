export type ReelMediaPlatform = 'youtube' | 'instagram' | 'unknown';

export type ReelProductChip = {
  id: string;
  catalogProductId: string | null;
  name: string;
  price: string;
  imageUrl: string;
  provider?: string | null;
};

/** Presentation model for Canonical Reel — not a backend entity. */
export type ReelViewModel = {
  collectionId: string;
  title: string | null;
  heroThumbnailUrl: string | null;
  qualityScore: number | null;
  creator: {
    id: string | null;
    handleOrName: string;
    username: string | null;
  };
  primaryMedia: {
    platform: ReelMediaPlatform;
    sourceUrl: string | null;
    embedUrl: string | null;
    thumbnailUrl: string | null;
  };
  products: ReelProductChip[];
};
