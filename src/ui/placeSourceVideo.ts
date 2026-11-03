import type { Video } from '@/src/mocks/videos';
import type { PlaceSourceVideo, PlaceStashItem } from '@/src/types/placeStash';
import { getVideoUrlInfo, transformToEmbedUrl } from '@/src/utils/videoUtils';

export const PLACE_SOURCE_COPY = {
  action: 'Source video', close: 'Close', retry: 'Retry',
  unavailable: 'Source video unavailable',
  unavailableHint: 'It may be private, removed, or temporarily unavailable.',
  loading: 'Loading source video…',
};

/** Older /places responses omit sourceVideo. Reuse already-loaded, owner-scoped
 * import history; both persisted identities must match. Explicit null from a
 * newer API is authoritative and must not be replaced with stale history. */
export function withPlaceSourceVideos(
  items: readonly PlaceStashItem[],
  shares: readonly { importId: string; contentSourceId: string | null; sourceUrl: string }[],
): PlaceStashItem[] {
  const urls = new Map(shares.filter(s => s.contentSourceId).map(s =>
    [JSON.stringify([s.contentSourceId, s.importId]), s.sourceUrl]));
  return items.map(item => {
    if (item.sourceVideo !== undefined || placeSourceVideos(item).length > 0) return item;
    const identities = [...(item.source ? [item.source] : []), ...(item.sources ?? [])];
    const videos = identities.flatMap(identity => {
      const url = urls.get(JSON.stringify([identity.contentSourceId, identity.userImportId]));
      const source = url ? { url, thumbnailUrl: item.image?.kind === 'source' ? item.image.url : null } : null;
      return source && placeSourcePreview(source) ? [source] : [];
    });
    const unique = [...new Map(videos.map(video => [video.url, video])).values()];
    return unique.length ? { ...item, sourceVideo: unique[0], sourceVideos: unique } : item;
  });
}

/** Validate the actual associated URL before passing it to existing players.
 * The shared older parser alone permits host-name substrings; this boundary does not. */
export function placeSourcePreview(source: PlaceSourceVideo | null | undefined): Video | null {
  if (!source?.url) return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be',
      'instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname.toLowerCase())) return null;
    const info = getVideoUrlInfo(source.url);
    const embed = transformToEmbedUrl(source.url);
    if (!info.isValid || !embed) return null;
    return { id: `source:${info.platform}:${info.videoId ?? info.postId}`, url: source.url,
      thumbnail: source.thumbnailUrl ?? '', embed_url: embed, creator_name: '', stash_score: 0, product_name: '' };
  } catch { return null; }
}


/** All actual associated videos, not just whichever source supplied the cover. */
export function placeSourceVideos(item: PlaceStashItem): PlaceSourceVideo[] {
  const videos = [...(item.sourceVideo ? [item.sourceVideo] : []), ...(item.sourceVideos ?? []),
    ...(item.sources ?? []).flatMap(source => source.sourceVideo ? [source.sourceVideo] : [])];
  return [...new Map(videos.filter(source => placeSourcePreview(source)).map(source => [source.url, source])).values()];
}
