import { getEnv } from '../env';
import { createSupabaseAdmin } from '../supabase';
import { createNotificationService } from './factory';
import {
  creatorStatusKey,
  engagementFactKey,
  ingestTerminalKey,
  librarySyncFailedKey,
  needsReauthKey,
  publishFailedKey,
  publishSucceededKey,
} from './domain/idempotencyKeys';
import type { EnqueueEventInput, EnqueueOutcome } from './domain/types';

/** Producers depend only on this; `emitSafely` never throws into the business path. */
export type NotificationEmitter = {
  emitSafely(input: EnqueueEventInput): Promise<EnqueueOutcome | null>;
};

export const NOOP_NOTIFICATION_EMITTER: NotificationEmitter = {
  async emitSafely() {
    return null;
  },
};

export function notificationProducersEnabled(): boolean {
  return getEnv('NOTIFICATIONS_PRODUCERS_ENABLED') !== 'false';
}

let shared: NotificationEmitter | null = null;

export function getNotificationEmitter(): NotificationEmitter {
  if (!notificationProducersEnabled()) return NOOP_NOTIFICATION_EMITTER;
  if (!shared) shared = createNotificationService(createSupabaseAdmin());
  return shared;
}

function clipTitle(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function ingestReadyEvent(input: {
  ingestId: string;
  userId: string;
  transitionAt: string;
  productCount: number;
  videoTitle?: string | null;
}): EnqueueEventInput {
  return {
    eventType: 'ingest.ready_for_review',
    idempotencyKey: ingestTerminalKey(input.ingestId, 'ready_for_review', input.transitionAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.transitionAt,
    payload: {
      ingestId: input.ingestId,
      productCount: Math.max(0, Math.trunc(input.productCount)),
      videoTitle: clipTitle(input.videoTitle),
    },
  };
}

export function ingestFailedEvent(input: {
  ingestId: string;
  userId: string;
  transitionAt: string;
}): EnqueueEventInput {
  return {
    eventType: 'ingest.failed',
    idempotencyKey: ingestTerminalKey(input.ingestId, 'failed', input.transitionAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.transitionAt,
    payload: { ingestId: input.ingestId },
  };
}

export function publishSucceededEvent(input: {
  collectionId: string;
  userId: string;
  publishedAt: string;
  collectionTitle?: string | null;
}): EnqueueEventInput {
  return {
    eventType: 'collection.publish_succeeded',
    idempotencyKey: publishSucceededKey(input.collectionId, input.publishedAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.publishedAt,
    payload: { collectionId: input.collectionId, collectionTitle: clipTitle(input.collectionTitle) },
  };
}

export function publishFailedEvent(input: {
  ingestId: string;
  userId: string;
  failedAt: string;
  collectionId?: string | null;
}): EnqueueEventInput {
  return {
    eventType: 'collection.publish_failed',
    idempotencyKey: publishFailedKey(input.ingestId, input.failedAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.failedAt,
    payload: { ingestId: input.ingestId, collectionId: input.collectionId ?? undefined },
  };
}

export function librarySyncFailedEvent(input: {
  connectedAccountId: string;
  userId: string;
  runStartedAt: string;
  failedAt: string;
  provider: string;
}): EnqueueEventInput {
  return {
    eventType: 'creator_library.sync_failed',
    idempotencyKey: librarySyncFailedKey(input.connectedAccountId, input.runStartedAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.failedAt,
    payload: { connectedAccountId: input.connectedAccountId, provider: input.provider },
  };
}

export function needsReauthEvent(input: {
  connectedAccountId: string;
  userId: string;
  transitionAt: string;
  provider: string;
}): EnqueueEventInput {
  return {
    eventType: 'connected_account.needs_reauth',
    idempotencyKey: needsReauthKey(input.connectedAccountId, input.transitionAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.transitionAt,
    payload: { connectedAccountId: input.connectedAccountId, provider: input.provider },
  };
}

export function creatorStatusEvent(input: {
  userId: string;
  from: string;
  to: string;
  changedAt: string;
}): EnqueueEventInput {
  return {
    eventType: 'creator.status_changed',
    idempotencyKey: creatorStatusKey(input.userId, input.to, input.changedAt),
    recipientUserId: input.userId,
    actorUserId: null,
    occurredAt: input.changedAt,
    payload: { status: input.to, from: input.from },
  };
}

/** Social producers: keyed on the engagement fact id; `occurredAt` is the fact's `created_at`. */
export function creatorFollowedEvent(input: {
  factEventId: string;
  recipientUserId: string;
  actorUserId: string;
  occurredAt: string;
}): EnqueueEventInput {
  return {
    eventType: 'creator.followed',
    idempotencyKey: engagementFactKey(input.factEventId),
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    payload: {},
  };
}

export function collectionSavedEvent(input: {
  factEventId: string;
  recipientUserId: string;
  actorUserId: string;
  occurredAt: string;
  collectionId: string;
}): EnqueueEventInput {
  return {
    eventType: 'collection.saved',
    idempotencyKey: engagementFactKey(input.factEventId),
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    payload: { collectionId: input.collectionId },
  };
}

export function reelLikedEvent(input: {
  factEventId: string;
  recipientUserId: string;
  actorUserId: string;
  occurredAt: string;
  collectionId: string;
}): EnqueueEventInput {
  return {
    eventType: 'reel.liked',
    idempotencyKey: engagementFactKey(input.factEventId),
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
    payload: { collectionId: input.collectionId },
  };
}
