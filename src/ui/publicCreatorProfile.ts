import { formatEngagementCount } from './formatEngagementCount';

export type PublicCreatorMetaId = 'posts' | 'followers' | 'following';

function count(value: number): number {
  return Math.max(0, Math.floor(value));
}

/**
 * Quiet public-profile figures — Instagram-style hierarchy using real
 * CreatorViewModel counts (posts = published collections).
 */
export function publicCreatorStats(input: {
  collectionCount: number;
  followersCount: number;
  followingCount: number;
}): { id: PublicCreatorMetaId; value: number; label: string }[] {
  return [
    { id: 'posts', value: count(input.collectionCount), label: 'Posts' },
    { id: 'followers', value: count(input.followersCount), label: 'Followers' },
    { id: 'following', value: count(input.followingCount), label: 'Following' },
  ];
}

export function publicCreatorMetaLine(input: {
  collectionCount: number;
  followersCount: number;
  followingCount: number;
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
