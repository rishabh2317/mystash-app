import type { ContentSourceService } from '../content-source/ContentSourceService';
import type { CreatorLibraryRepository } from './CreatorLibraryRepository';
import { youtubeWatchUrl, type YouTubeLibraryItem } from './youtubePlaylist';

/**
 * Upserts global content identity + creator membership for one playlist page.
 * Does not enqueue content-source extraction and does not delete identities.
 */
export async function applyLibraryPage(params: {
  contentSources: ContentSourceService;
  library: CreatorLibraryRepository;
  userId: string;
  connectedAccountId: string;
  items: YouTubeLibraryItem[];
  seenAt: string;
}): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const item of params.items) {
    const resolved = await params.contentSources.getOrCreate(youtubeWatchUrl(item.videoId));
    await params.contentSources.patchDisplay(resolved.record.id, {
      title: item.title,
      thumbnailUrl: item.thumbnailUrl,
      publishedAt: item.publishedAt,
    });
    await params.library.upsertMembership({
      userId: params.userId,
      connectedAccountId: params.connectedAccountId,
      contentSourceId: resolved.record.id,
      availability: item.availability,
      lastSeenAt: params.seenAt,
    });
    upserted += 1;
  }
  return { upserted };
}
