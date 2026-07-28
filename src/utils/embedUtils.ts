/**
 * Utility functions for converting social media URLs to embed URLs
 */

export interface PlatformType {
  YOUTUBE: 'youtube';
  INSTAGRAM: 'instagram';
}

export function getPlatformType(url: string): PlatformType[keyof PlatformType] | null {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'youtube';
  }
  if (url.includes('instagram.com')) {
    return 'instagram';
  }
  return null;
}

export function convertToEmbedUrl(url: string): string | null {
  const platform = getPlatformType(url);
  
  if (platform === 'youtube') {
    let videoId: string | undefined;
    
    // Handle YouTube Shorts format: youtube.com/shorts/VIDEO_ID
    if (url.includes('/shorts/')) {
      videoId = url.split('/shorts/')[1]?.split('?')[0]?.split('&')[0];
    }
    // Handle youtu.be format: youtu.be/VIDEO_ID
    else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0]?.split('&')[0];
    }
    // Handle regular YouTube format: youtube.com/watch?v=VIDEO_ID
    else if (url.includes('v=')) {
      videoId = url.split('v=')[1]?.split('&')[0];
    }
    
    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`;
    }
  }
  
  if (platform === 'instagram') {
    // For Instagram, we use oEmbed API which handles both posts and reels
    // Extract the post ID from various Instagram URL formats
    let postId: string | undefined;
    
    if (url.includes('/reels/')) {
      postId = url.split('instagram.com/reels/')[1]?.split('/')[0];
    } else if (url.includes('/p/')) {
      postId = url.split('instagram.com/p/')[1]?.split('/')[0];
    } else if (url.includes('/reel/')) {
      postId = url.split('instagram.com/reel/')[1]?.split('/')[0];
    }
    
    if (postId) {
      // Use oEmbed endpoint for better compatibility
      return `https://www.instagram.com/p/${postId}/embed/caption/?url=${encodeURIComponent(url)}&utm_source=ig_web_copy_link`;
    }
  }
  
  return null;
}

export function getThumbnailUrl(url: string): string | null {
  const platform = getPlatformType(url);
  
  if (platform === 'youtube') {
    const videoId = url.includes('youtu.be/') 
      ? url.split('youtu.be/')[1]?.split('?')[0]?.split('&')[0]
      : url.split('v=')[1]?.split('&')[0];
    
    if (videoId) {
      return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
  }
  
  // For Instagram, we'll use a placeholder since Instagram doesn't provide
  // direct thumbnail access without API calls
  if (platform === 'instagram') {
    return 'https://picsum.photos/seed/instagram/640/1136.jpg';
  }
  
  return null;
}
