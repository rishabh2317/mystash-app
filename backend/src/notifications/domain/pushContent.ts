import type { PushMessage } from '../providers/types';
import { safeDeepLink } from './deepLinks';
import { PUSH_PAYLOAD_MAX_BYTES } from './pushPolicy';
import { toNotificationView } from './render';
import type { ActorProfile, NotificationCategory, NotificationRecord } from './types';

/** One row returned by notification_begin_push_send. The token never leaves the worker. */
export type BegunDelivery = {
  deliveryId: string;
  attemptNo: number;
  provider: string;
  token: string;
  tokenFingerprint: string;
  platform: 'ios' | 'android';
  notificationId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink: string | null;
  groupKey: string | null;
  actorCount: number;
  sampleActorIds: string[];
  sendDeadline: string;
};

/**
 * Lock-screen copy. Task bodies may quote user content (video / Collection titles), so pushes use
 * fixed bodies; account (and future security) pushes are fully generic.
 */
const TASK_PUSH_BODY: Record<string, string> = {
  'collection.publish_succeeded': 'Your Collection is now published.',
  'collection.publish_failed': 'Open your draft to try again.',
  'ingest.ready_for_review': 'Open your draft to review it before publishing.',
  'ingest.failed': 'Open your draft to add products or try again.',
  'creator_library.sync_failed': 'Open settings to try the sync again.',
};
const GENERIC_ACCOUNT = { title: 'Account update', body: 'Open Mystash to see what changed.' };

export const ANDROID_CHANNEL_BY_CATEGORY: Record<NotificationCategory, string> = {
  social: 'social',
  task: 'activity',
  account: 'account',
  security: 'account',
  promo: 'promo',
};

export function pushText(
  delivery: BegunDelivery,
  actorsById: ReadonlyMap<string, ActorProfile>,
): { title: string; body: string; deepLink: string } {
  const storedLink = safeDeepLink(delivery.deepLink);
  if (delivery.category === 'account' || delivery.category === 'security') {
    return { ...GENERIC_ACCOUNT, deepLink: storedLink };
  }
  if (delivery.category === 'task') {
    return {
      title: delivery.title,
      body: TASK_PUSH_BODY[delivery.type] ?? 'Open Mystash to continue.',
      deepLink: storedLink,
    };
  }
  const record: NotificationRecord = {
    id: delivery.notificationId,
    userId: '',
    type: delivery.type,
    category: delivery.category,
    title: delivery.title,
    body: delivery.body,
    data: {},
    deepLink: delivery.deepLink,
    groupKey: delivery.groupKey,
    actorCount: delivery.actorCount,
    sampleActorIds: delivery.sampleActorIds,
    sortAt: new Date(0).toISOString(),
    seenAt: null,
    readAt: null,
    createdAt: new Date(0).toISOString(),
  };
  const view = toNotificationView(record, actorsById);
  return { title: view.title, body: view.body, deepLink: view.deepLink };
}

export function remainingTtlSeconds(sendDeadline: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(sendDeadline) - now) / 1000));
}

export function payloadBytes(message: Pick<PushMessage, 'title' | 'body' | 'data'>): number {
  return Buffer.byteLength(JSON.stringify({ title: message.title, body: message.body, data: message.data }), 'utf8');
}

/** null = cannot fit in the provider payload limit even after trimming the body. */
export function buildPushMessage(
  delivery: BegunDelivery,
  actorsById: ReadonlyMap<string, ActorProfile>,
  now: number,
): PushMessage | null {
  const text = pushText(delivery, actorsById);
  const message: PushMessage = {
    deliveryId: delivery.deliveryId,
    attemptNo: delivery.attemptNo,
    token: delivery.token,
    title: text.title,
    body: text.body,
    data: {
      v: 1,
      nid: delivery.notificationId,
      did: delivery.deliveryId,
      type: delivery.type,
      link: text.deepLink,
    },
    collapseId: delivery.notificationId,
    tag: delivery.notificationId,
    threadId: delivery.groupKey ?? undefined,
    channelId: delivery.platform === 'android' ? ANDROID_CHANNEL_BY_CATEGORY[delivery.category] : undefined,
    ttlSeconds: remainingTtlSeconds(delivery.sendDeadline, now),
    priority: delivery.category === 'social' || delivery.category === 'promo' ? 'normal' : 'high',
  };
  while (payloadBytes(message) > PUSH_PAYLOAD_MAX_BYTES && message.body.length > 40) {
    message.body = `${message.body.slice(0, Math.floor(message.body.length * 0.8))}…`;
  }
  return payloadBytes(message) > PUSH_PAYLOAD_MAX_BYTES ? null : message;
}
