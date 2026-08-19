/**
 * Canonical source identity for ingest entry points.
 * YouTube Shorts and Instagram Reels/posts share this layer; Product Intelligence is downstream.
 */

export type SupportedVideoPlatform = 'youtube' | 'instagram';

export type SupportedVideoIdentity = {
  platform: SupportedVideoPlatform;
  externalId: string;
  canonicalUrl: string;
  originalUrl: string;
};

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /(?:[?&]v=)([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1]) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function extractInstagramPostId(url: string): string | null {
  try {
    const patterns = [
      /(?:instagram\.com\/(?:reel|reels|p|tv)\/)([A-Za-z0-9_-]+)/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1]) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function detectPlatform(url: string): 'youtube' | 'instagram' | 'unknown' {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  return 'unknown';
}

/**
 * Accept only concrete Short / Reel / post identities.
 * Profile URLs (instagram.com/username) and unknown hosts are rejected.
 */
export function parseSupportedVideoUrl(raw: string): SupportedVideoIdentity | null {
  const originalUrl = raw.trim();
  if (!originalUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const platform = detectPlatform(parsed.href);
  if (platform === 'youtube') {
    const id = extractYouTubeVideoId(parsed.href);
    if (!id) return null;
    return {
      platform,
      externalId: id,
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      originalUrl,
    };
  }
  if (platform === 'instagram') {
    const id = extractInstagramPostId(parsed.href);
    if (!id) return null;
    return {
      platform,
      externalId: id,
      canonicalUrl: `https://www.instagram.com/reel/${id}/`,
      originalUrl,
    };
  }
  return null;
}

export function unsupportedVideoUrlMessage(): string {
  return 'Paste a YouTube Shorts or Instagram Reel / post URL. Profile pages and other sites are not supported.';
}
