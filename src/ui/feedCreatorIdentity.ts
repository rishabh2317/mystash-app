import type { Video } from '@/src/mocks/videos';
import { creatorPath } from '@/src/services/sharePaths';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLikelyUserId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Public profile handle from feed `curator_id` (`@name` or `name`). UUID is not a username. */
export function creatorUsernameFromFeed(
  video: Pick<Video, 'curator_id'>,
): string | null {
  const raw = video.curator_id?.trim() ?? '';
  const handle = raw.replace(/^@/, '').trim();
  if (!handle || isLikelyUserId(handle)) return null;
  return handle;
}

export function creatorDisplayNameFromFeed(
  video: Pick<Video, 'curator_id' | 'creator_name'>,
): string {
  const name = video.creator_name?.trim();
  if (name) return name;
  const handle = creatorUsernameFromFeed(video);
  if (handle) return `@${handle}`;
  return 'Creator';
}

export function creatorProfileHref(username: string): string {
  return creatorPath(username);
}

/** Follow needs a creator UUID and must never appear on your own reel. */
export function shouldShowFeedFollow(opts: {
  creatorId: string | null | undefined;
  isSelf: boolean;
}): boolean {
  return Boolean(opts.creatorId?.trim()) && !opts.isSelf;
}
