import { fetchVideos } from '@/src/services/supabase';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { isFollowingCreator } from '@/src/services/engagementApi';
import { fetchPublicCreatorByUsername } from '@/src/services/userApi';
import {
  buildDiscoverCreatorSeeds,
  DISCOVER_CREATORS_PAGE_LIMIT,
  type DiscoverCreatorSuggestion,
} from '@/src/ui/discoverCreators';

/**
 * Loads Discover Creators suggestions from the Home feed creator stream
 * (same source as Search discovery). Hydrates public profiles, follow state,
 * and up to 3 collection thumbnails. Never invents mutuals.
 */
export async function loadDiscoverCreatorSuggestions(opts: {
  excludeUserId?: string | null;
  excludeUsername?: string | null;
  limit?: number;
}): Promise<DiscoverCreatorSuggestion[]> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? DISCOVER_CREATORS_PAGE_LIMIT),
    DISCOVER_CREATORS_PAGE_LIMIT,
  );

  let videos;
  try {
    videos = await fetchVideos();
  } catch {
    return [];
  }

  const seeds = buildDiscoverCreatorSeeds(videos, {
    excludeUserId: opts.excludeUserId,
    excludeUsername: opts.excludeUsername,
    limit,
  });

  const out: DiscoverCreatorSuggestion[] = [];
  for (const seed of seeds) {
    try {
      const profile = await fetchPublicCreatorByUsername(seed.username);
      if (opts.excludeUserId && profile.userId === opts.excludeUserId) continue;

      let isFollowing = false;
      try {
        isFollowing = await isFollowingCreator(profile.userId);
      } catch {
        isFollowing = false;
      }

      let previewUrls: string[] = [];
      try {
        const page = await listCreatorCollections(profile.userId, { limit: 3 });
        previewUrls = page.collections
          .map((c) => c.heroThumbnailUrl?.trim() || null)
          .filter((u): u is string => Boolean(u))
          .slice(0, 3);
      } catch {
        previewUrls = [];
      }

      out.push({
        creator: { ...profile, isFollowing },
        previewUrls,
        followedByLabel: null,
      });
    } catch {
      /* skip unavailable creators */
    }
  }
  return out;
}
