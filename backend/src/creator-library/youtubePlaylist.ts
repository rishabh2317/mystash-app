/** YouTube uploads playlist mapping. Metadata and IDs only. */

export const LIBRARY_SYNC_PAGE_SIZE = 50;
export const LIBRARY_SYNC_PAGES_PER_JOB = 4;

export type YouTubeLibraryItem = {
  videoId: string;
  title: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  /** private items stay in the library as unavailable; public/unlisted are available. */
  availability: 'available' | 'unavailable';
};

type Thumbnails = Record<string, { url?: string } | undefined>;

export function pickThumbnail(thumbnails: Thumbnails | undefined): string | null {
  if (!thumbnails) return null;
  return (
    thumbnails.medium?.url ??
    thumbnails.high?.url ??
    thumbnails.default?.url ??
    thumbnails.standard?.url ??
    null
  );
}

export function mapPlaylistItem(raw: {
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: Thumbnails;
    resourceId?: { videoId?: string };
  };
  contentDetails?: { videoId?: string };
  status?: { privacyStatus?: string };
}): YouTubeLibraryItem | null {
  const videoId = raw.contentDetails?.videoId || raw.snippet?.resourceId?.videoId;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  const privacy = raw.status?.privacyStatus;
  return {
    videoId,
    title: raw.snippet?.title ?? null,
    thumbnailUrl: pickThumbnail(raw.snippet?.thumbnails),
    publishedAt: raw.snippet?.publishedAt ?? null,
    availability: privacy === 'private' ? 'unavailable' : 'available',
  };
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
