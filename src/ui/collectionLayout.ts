import type { Video } from '@/src/mocks/videos';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type {
  CollectionDetailViewModel,
  CollectionMediaPlatform,
} from '@/src/types/collectionDetail';

/** Featured rail only when the Collection has enough products to browse twice. */
export const FEATURED_RAIL_MIN = 4;
export const FEATURED_RAIL_COUNT = 3;

export const ORIGINAL_REEL_LABEL = 'Original Reel';

/** Horizontal padding on Collection scroll content. */
export const COLLECTION_SCROLL_HORIZONTAL_PADDING = 16;

/** Compact portrait player width — editorial, not full-screen. */
export const COLLECTION_INLINE_PLAYER_MAX_WIDTH = 240;
export const COLLECTION_INLINE_PLAYER_MIN_WIDTH = 200;

export type CollectionMediaReferenceModel = {
  collectionId: string;
  posterUrl: string | null;
  platform: CollectionMediaPlatform | null;
  reelPath: string;
  label: typeof ORIGINAL_REEL_LABEL;
  embedUrl: string | null;
  sourceUrl: string | null;
  title: string | null;
};

/** Collection mounts a compact inline embed (not a second full-screen Reel). */
export const COLLECTION_PAGE_EMBEDS_PLAYER = true;

export function collectionReelPath(collectionId: string): string {
  return `/reel/${collectionId}`;
}

/** Primary tap target for Collection tiles/cards (Focused Reel, not Collection page). */
export function collectionTilePressPath(collectionId: string): string {
  return collectionReelPath(collectionId);
}

export function splitCollectionProducts(products: CatalogProductViewModel[]): {
  featured: CatalogProductViewModel[];
  shopAll: CatalogProductViewModel[];
} {
  if (products.length < FEATURED_RAIL_MIN) {
    return { featured: [], shopAll: products };
  }
  return {
    featured: products.slice(0, FEATURED_RAIL_COUNT),
    shopAll: products,
  };
}

export function collectionMediaReference(
  collection: CollectionDetailViewModel,
): CollectionMediaReferenceModel | null {
  const media = collection.primaryMedia;
  const posterUrl = media?.thumbnailUrl ?? collection.heroThumbnailUrl ?? null;
  const hasSource = Boolean(media?.sourceUrl || media?.embedUrl || posterUrl);
  if (!hasSource) return null;
  return {
    collectionId: collection.collectionId,
    posterUrl,
    platform: media?.platform ?? null,
    reelPath: collectionReelPath(collection.collectionId),
    label: ORIGINAL_REEL_LABEL,
    embedUrl: media?.embedUrl ?? null,
    sourceUrl: media?.sourceUrl ?? null,
    title: media?.title ?? collection.title,
  };
}

/** Public watch URL for the source reel (not the embed iframe URL). */
export function collectionMediaSourceUrl(
  media: CollectionMediaReferenceModel,
): string | null {
  const source = media.sourceUrl?.trim();
  return source || null;
}

/** Video shape for existing YT/IG WebView embed utilities. */
export function buildCollectionPreviewVideo(
  collection: CollectionDetailViewModel,
): Video | null {
  const media = collection.primaryMedia;
  if (!media?.sourceUrl && !media?.embedUrl) return null;
  const url = media.sourceUrl ?? media.embedUrl ?? '';
  return {
    id: `collection-preview:${collection.collectionId}`,
    url,
    thumbnail: media.thumbnailUrl ?? collection.heroThumbnailUrl ?? '',
    creator_name: collection.creator.displayName ?? collection.creator.username ?? 'Creator',
    stash_score: collection.qualityScore ?? 0,
    product_name: collection.products[0]?.title ?? collection.title ?? 'Collection',
    embed_url: media.embedUrl ?? undefined,
    video_title: media.title ?? collection.title ?? undefined,
    curator_id: collection.creator.username ?? undefined,
    collection_id: collection.collectionId,
  };
}

export function originalReelPlatformLabel(platform: CollectionMediaPlatform | null): string {
  if (platform === 'youtube') return 'YouTube Short';
  if (platform === 'instagram') return 'Instagram Reel';
  return ORIGINAL_REEL_LABEL;
}

/** Tappable label for the public source URL below the inline player. */
export function collectionMediaWatchLinkLabel(platform: CollectionMediaPlatform | null): string | null {
  if (platform === 'youtube') return 'Watch on YT';
  if (platform === 'instagram') return 'Watch on Instagram';
  return null;
}

export function collectionInlinePlayerWidth(screenWidth: number): number {
  const target = Math.round(screenWidth * 0.58);
  return Math.max(
    COLLECTION_INLINE_PLAYER_MIN_WIDTH,
    Math.min(COLLECTION_INLINE_PLAYER_MAX_WIDTH, target),
  );
}

export function collectionReelPlayerSize(screenWidth: number): { width: number; height: number } {
  const width = collectionInlinePlayerWidth(screenWidth);
  return { width, height: Math.round(width * (16 / 9)) };
}
