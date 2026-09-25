/**
 * Personal Profile “Discover Creators You'll Love” — pure mapping over Home feed
 * creators (same discovery source as Search landing). No new recommendation API.
 */

import type { Video } from '@/src/mocks/videos';
import type { CreatorViewModel } from '@/src/types/creator';
import {
  creatorUsernameFromFeed,
  isLikelyUserId,
} from '@/src/ui/feedCreatorIdentity';

export const DISCOVER_CREATORS_COPY = {
  title: "Discover Creators You'll Love",
  seeMore: 'See more',
  followedByUnavailable: null,
} as const;

/** Compact rail on Personal Profile. */
export const DISCOVER_CREATORS_PROFILE_LIMIT = 6;
/** Full See more page hard cap. */
export const DISCOVER_CREATORS_PAGE_LIMIT = 15;

export type DiscoverCreatorSeed = {
  username: string;
  creatorId: string | null;
};

export type DiscoverCreatorSuggestion = {
  creator: CreatorViewModel;
  /** Up to 3 real collection hero thumbs for the detail card. */
  previewUrls: string[];
  /**
   * Mutual / social-proof line when the product has real data.
   * Always null today — do not invent.
   */
  followedByLabel: string | null;
};

/**
 * Unique feed creators with a public username, excluding the viewer.
 * Order follows first appearance in the feed (recency of Home).
 */
export function buildDiscoverCreatorSeeds(
  videos: Video[],
  opts: {
    excludeUserId?: string | null;
    excludeUsername?: string | null;
    limit: number;
  },
): DiscoverCreatorSeed[] {
  const excludeId = opts.excludeUserId?.trim() || null;
  const excludeHandle = opts.excludeUsername?.trim().replace(/^@/, '').toLowerCase() || null;
  const seen = new Set<string>();
  const out: DiscoverCreatorSeed[] = [];

  for (const video of videos) {
    const username = creatorUsernameFromFeed(video);
    if (!username) continue;
    const key = username.toLowerCase();
    if (excludeHandle && key === excludeHandle) continue;
    if (seen.has(key)) continue;

    const curatorRaw = video.curator_id?.trim().replace(/^@/, '') || null;
    const creatorId = curatorRaw && isLikelyUserId(curatorRaw) ? curatorRaw : null;
    if (excludeId && creatorId && creatorId === excludeId) continue;

    seen.add(key);
    out.push({ username, creatorId });
    if (out.length >= opts.limit) break;
  }
  return out;
}

export function discoverCreatorsProfileSlice(
  items: DiscoverCreatorSuggestion[],
): DiscoverCreatorSuggestion[] {
  return items.slice(0, DISCOVER_CREATORS_PROFILE_LIMIT);
}

export function discoverCreatorsPageSlice(
  items: DiscoverCreatorSuggestion[],
): DiscoverCreatorSuggestion[] {
  return items.slice(0, DISCOVER_CREATORS_PAGE_LIMIT);
}
