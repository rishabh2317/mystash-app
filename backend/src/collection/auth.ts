import type { CreatorSnapshot } from './domain/types';

export type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export function buildCreatorSnapshot(user: AuthUserLike): CreatorSnapshot {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const username =
    str(meta.preferred_username) ||
    str(meta.user_name) ||
    str(meta.username) ||
    user.email?.split('@')[0] ||
    null;
  const name = str(meta.full_name) || str(meta.name) || username;
  const avatar = str(meta.avatar_url) || str(meta.picture) || null;
  const verified = Boolean(meta.email_verified ?? meta.verified ?? false);

  return {
    creatorName: name,
    creatorUsername: username,
    creatorAvatar: avatar,
    creatorVerified: verified,
    creatorSnapshotUpdatedAt: new Date().toISOString(),
  };
}

export function assertCollectionOwner(
  collectionCreatorId: string,
  userId: string,
): void {
  if (collectionCreatorId !== userId) {
    const err = new Error('Collection not found');
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
