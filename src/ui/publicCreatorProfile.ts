import { formatEngagementCount } from './formatEngagementCount';

export type PublicCreatorMetaId = 'collections' | 'followers' | 'likes';

function count(value: number): number {
  return Math.max(0, Math.floor(value));
}

/** Quiet public-profile figures — real CreatorViewModel counts only. */
export function publicCreatorStats(input: {
  collectionCount: number;
  followersCount: number;
  totalReelLikesReceived: number;
}): { id: PublicCreatorMetaId; value: number; label: string }[] {
  return [
    { id: 'collections', value: count(input.collectionCount), label: 'Collections' },
    { id: 'followers', value: count(input.followersCount), label: 'Followers' },
    { id: 'likes', value: count(input.totalReelLikesReceived), label: 'Likes' },
  ];
}

export function publicCreatorMetaLine(input: {
  collectionCount: number;
  followersCount: number;
  totalReelLikesReceived: number;
}): string {
  return publicCreatorStats(input)
    .map((item) => `${formatEngagementCount(item.value)} ${item.label}`)
    .join(' · ');
}

export function publicCollectionProductLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return `${n} product${n === 1 ? '' : 's'}`;
}

/**
 * Materialized `collection_count` on User is often stale (never bumped on
 * publish). Prefer the larger of the reported stat and collections already
 * loaded for the public grid.
 */
export function reconcilePublicCollectionCount(
  reportedCount: number,
  loadedPublishedCount: number,
): number {
  return Math.max(count(reportedCount), count(loadedPublishedCount));
}
