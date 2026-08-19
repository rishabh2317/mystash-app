/**
 * Robust video URL processing utilities
 * Handles YouTube and Instagram URL transformation with validation
 */

export interface VideoPlatform {
  YOUTUBE: 'youtube';
  INSTAGRAM: 'instagram';
}

export interface VideoUrlInfo {
  platform: VideoPlatform[keyof VideoPlatform] | null;
  videoId: string | null;
  postId: string | null;
  isValid: boolean;
}

/**
 * Validates if a string is a valid URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the video platform from URL
 */
export function detectPlatform(url: string): VideoPlatform[keyof VideoPlatform] | null {
  if (!isValidUrl(url)) return null;
  
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
    return 'youtube';
  }
  
  if (lowerUrl.includes('instagram.com')) {
    return 'instagram';
  }
  
  return null;
}

/**
 * Extracts YouTube video ID using regex patterns
 * Handles: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!isValidUrl(url)) return null;
  
  const patterns = [
    // Standard YouTube: youtube.com/watch?v=VIDEO_ID
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    // YouTube Shorts: youtube.com/shorts/VIDEO_ID
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    // YouTube with additional parameters: youtube.com/watch?v=VIDEO_ID&...
    /(?:[?&]v=)([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Extracts Instagram post ID using regex patterns
 * Handles: /p/, /reels/, /reel/ paths
 */
export function extractInstagramPostId(url: string): string | null {
  if (!isValidUrl(url)) return null;
  
  const patterns = [
    /(?:instagram\.com\/(?:reel|reels|p|tv)\/)([A-Za-z0-9_-]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Transforms video URL to clean embed URL with proper parameters
 */
export function transformToEmbedUrl(url: string): string | null {
  if (!isValidUrl(url)) return null;
  
  const platform = detectPlatform(url);
  
  if (platform === 'youtube') {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;
    
    // Use minimal parameters to avoid Error 153
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '1',
      playsinline: '1',
      controls: '1', // Required for proper initialization
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

/**
 * In-app review preview: no autoplay (avoids YouTube WebView error 153 / policy issues).
 */
export function transformToReviewEmbedUrl(url: string): string | null {
  if (!isValidUrl(url)) return null;

  const platform = detectPlatform(url);

  if (platform === 'youtube') {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;
    const params = new URLSearchParams({
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

/**
 * Gets comprehensive URL information
 */
export function getVideoUrlInfo(url: string): VideoUrlInfo {
  const platform = detectPlatform(url);
  let videoId: string | null = null;
  let postId: string | null = null;
  
  if (platform === 'youtube') {
    videoId = extractYouTubeVideoId(url);
  } else if (platform === 'instagram') {
    postId = extractInstagramPostId(url);
  }
  
  return {
    platform,
    videoId,
    postId,
    isValid: !!(platform && (videoId || postId))
  };
}

/**
 * Validates if URL is a supported video platform
 */
export function isSupportedVideoUrl(url: string): boolean {
  const info = getVideoUrlInfo(url);
  return info.isValid;
}

/**
 * Gets thumbnail URL for YouTube videos
 */
export function getYouTubeThumbnailUrl(url: string, quality: 'default' | 'medium' | 'high' | 'maxres' = 'maxres'): string | null {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;
  
  const qualityMap = {
    default: 'default',
    medium: 'mqdefault',
    high: 'hqdefault',
    maxres: 'maxresdefault'
  };
  
  return `https://img.youtube.com/vi/${videoId}/${qualityMap[quality]}.jpg`;
}

/**
 * Gets placeholder thumbnail URL for Instagram videos
 */
export function getInstagramThumbnailUrl(): string {
  return 'https://picsum.photos/seed/instagram/640/1136.jpg';
}
