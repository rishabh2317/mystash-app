import type { Video } from '@/src/mocks/videos';
import type { CollectionViewModel } from '@/src/types/collection';

const EXPLORE_LIMIT = 30;

/** Map a Home-feed video row onto a Collection tile. Skips rows without a collection identity. */
export function videoToExploreCollection(video: Video): CollectionViewModel | null {
  const collectionId = video.collection_id?.trim();
  if (!collectionId) return null;
  return {
    collectionId,
    slug: collectionId,
    title: video.video_title?.trim() || video.product_name?.trim() || null,
    heroThumbnailUrl: video.thumbnail?.trim() || null,
    productCount: video.products?.length ?? 0,
    publishedAt: null,
    creator: {
      id: video.curator_id?.trim() || 'unknown',
      username: null,
      displayName: video.creator_name?.trim() || null,
      avatarUrl: null,
    },
    counters: { views: 0, saves: 0 },
  };
}

/**
 * Chronological published Collections for the Search landing grid.
 * Newest-first (same order as Home `fetchVideos`). Not trending or personalised.
 */
export function videosToExploreCollections(videos: Video[]): CollectionViewModel[] {
  const seen = new Set<string>();
  const out: CollectionViewModel[] = [];
  for (const video of videos) {
    const mapped = videoToExploreCollection(video);
    if (!mapped || seen.has(mapped.collectionId)) continue;
    seen.add(mapped.collectionId);
    out.push(mapped);
    if (out.length >= EXPLORE_LIMIT) break;
  }
  return out;
}
