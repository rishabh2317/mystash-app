import {
  mapCollectionDetailToReelViewModel,
  mapReelViewModelToVideo,
} from '@/src/mappers/reelMapper';
import type { Video } from '@/src/mocks/videos';
import { loadCollectionDetail } from '@/src/services/collectionHydration';

const videoCache = new Map<string, Video>();

/** Lightweight Collection → Video for ReelItem (clears on full session end). */
export async function hydrateSearchReelVideo(collectionId: string): Promise<Video> {
  const id = collectionId.trim();
  const cached = videoCache.get(id);
  if (cached) return cached;

  const detail = await loadCollectionDetail(id);
  const video = mapReelViewModelToVideo(mapCollectionDetailToReelViewModel(detail));
  videoCache.set(id, video);
  return video;
}

export function peekSearchReelVideo(collectionId: string): Video | null {
  return videoCache.get(collectionId.trim()) ?? null;
}

export function clearSearchReelVideoCache(): void {
  videoCache.clear();
}
