import { detectPlatform, extractYouTubeVideoId } from './detect.ts';

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function extractInstagramPostId(url: string): string | null {
  if (!isValidUrl(url)) return null;
  const patterns = [
    /(?:instagram\.com\/p\/)([A-Za-z0-9_-]+)/,
    /(?:instagram\.com\/reels\/)([A-Za-z0-9_-]+)/,
    /(?:instagram\.com\/reel\/)([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function transformToEmbedUrl(url: string, platformHint?: string): string | null {
  if (!isValidUrl(url)) return null;
  const platform = platformHint ?? detectPlatform(url);

  if (platform === 'youtube') {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '1',
      playsinline: '1',
      controls: '1',
      modestbranding: '1',
      rel: '0',
      enablejsapi: '1',
    });
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }

  if (platform === 'instagram') {
    const postId = extractInstagramPostId(url);
    if (!postId) return null;
    return `https://www.instagram.com/p/${postId}/embed/?captioned=0`;
  }

  return null;
}
