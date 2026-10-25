import { creatorLink, safeDeepLink } from './deepLinks';
import { NOTIFICATION_TYPES, isNotificationEventType } from './eventTypes';
import type { ActorProfile, NotificationRecord, NotificationView } from './types';

const ACTOR_PHRASES: Record<string, { title: (n: number) => string; verb: string }> = {
  'creator.followed': { title: (n) => (n > 1 ? 'New followers' : 'New follower'), verb: 'followed you' },
  'collection.saved': { title: () => 'Collection saved', verb: 'saved your Collection' },
  'reel.liked': { title: (n) => (n > 1 ? 'New likes' : 'New like'), verb: 'liked your Reel' },
};

function actorName(actor: ActorProfile): string {
  return actor.displayName?.trim() || actor.username;
}

/** "Ana", "Ana and Ben", "Ana and 3 others", or "Someone" / "3 people" when no profile is visible. */
export function describeActors(actors: ActorProfile[], actorCount: number): string {
  const total = Math.max(actorCount, actors.length);
  if (actors.length === 0) return total > 1 ? `${total} people` : 'Someone';
  const first = actorName(actors[0]);
  if (total === 1) return first;
  if (total === 2 && actors.length >= 2) return `${first} and ${actorName(actors[1])}`;
  const others = total - 1;
  return `${first} and ${others} ${others === 1 ? 'other' : 'others'}`;
}

/**
 * Actor-bearing types are rendered from active profiles at read time; deleted or suspended
 * actors are absent from `actorsById` and therefore never named.
 */
export function toNotificationView(
  record: NotificationRecord,
  actorsById: ReadonlyMap<string, ActorProfile>,
): NotificationView {
  const actors = record.sampleActorIds
    .map((id) => actorsById.get(id))
    .filter((a): a is ActorProfile => Boolean(a));
  const phrase = ACTOR_PHRASES[record.type];
  const def = isNotificationEventType(record.type) ? NOTIFICATION_TYPES[record.type] : null;

  let title = record.title;
  let body = record.body;
  let deepLink = safeDeepLink(record.deepLink);
  if (phrase && def?.requiresActor) {
    title = phrase.title(record.actorCount);
    body = `${describeActors(actors, record.actorCount)} ${phrase.verb}.`;
    if (record.type === 'creator.followed' && record.actorCount === 1 && actors[0]) {
      deepLink = creatorLink(actors[0].username);
    }
  }

  return {
    id: record.id,
    type: record.type,
    category: record.category,
    title,
    body,
    deepLink,
    actors: actors.map((a) => ({
      id: a.id,
      username: a.username,
      displayName: a.displayName,
      profilePhotoUrl: a.profilePhotoUrl,
    })),
    actorCount: record.actorCount,
    read: record.readAt !== null,
    seen: record.seenAt !== null,
    createdAt: record.createdAt,
    updatedAt: record.sortAt,
  };
}

export function encodeFeedCursor(cursor: { sortAt: string; id: string }): string {
  return Buffer.from(`${cursor.sortAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeFeedCursor(raw: string): { sortAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const [sortAt, id] = decoded.split('|');
    if (!sortAt || !id || Number.isNaN(Date.parse(sortAt))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { sortAt, id };
  } catch {
    return null;
  }
}
