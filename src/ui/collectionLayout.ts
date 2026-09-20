import type { Video } from '@/src/mocks/videos';
import type {
  CollectionDetailViewModel,
  CollectionMediaPlatform,
} from '@/src/types/collectionDetail';

export const ORIGINAL_REEL_LABEL = 'Original Reel';

/** Horizontal padding on Collection scroll content. */
export const COLLECTION_SCROLL_HORIZONTAL_PADDING = 16;

/** Source Reels are portrait; Collection never crops them to landscape. */
export const COLLECTION_MEDIA_ASPECT = 9 / 16;
/**
 * Share of viewport height the editorial media frame may occupy. Tuned so a
 * portrait reel nearly fills the content column on a typical phone — the
 * evidence should dominate the page — while the next section still peeks.
 */
export const COLLECTION_MEDIA_MAX_HEIGHT_RATIO = 0.66;
/** Fallback frame width for the frames before the viewport height is measured. */
export const COLLECTION_MEDIA_MIN_WIDTH = 200;
/** Crop applied to the Collection YouTube iframe so native title/end-screen chrome stays off-frame. */
export const COLLECTION_YOUTUBE_CROP_SCALE = 1.38;

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

/**
 * Editorial media frame: as wide as the content column allows while keeping the
 * source Reel's portrait framing and staying within the viewport.
 */
export function collectionMediaFrameSize(input: {
  screenWidth: number;
  screenHeight: number;
  gutter?: number;
}): { width: number; height: number } {
  const gutter = input.gutter ?? COLLECTION_SCROLL_HORIZONTAL_PADDING;
  const contentWidth = Math.max(0, input.screenWidth - gutter * 2);
  const heightBudget = Math.max(0, input.screenHeight) * COLLECTION_MEDIA_MAX_HEIGHT_RATIO;
  // The content column and the height the page can spare are both hard limits:
  // a short viewport shortens the frame rather than cropping the portrait
  // source. Until the viewport is measured there is no budget to divide.
  const widthFromHeight =
    heightBudget > 0
      ? heightBudget * COLLECTION_MEDIA_ASPECT
      : Math.min(COLLECTION_MEDIA_MIN_WIDTH, contentWidth);
  const width = Math.round(Math.min(contentWidth, widthFromHeight));
  return { width, height: Math.round(width / COLLECTION_MEDIA_ASPECT) };
}
