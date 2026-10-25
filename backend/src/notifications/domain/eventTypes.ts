import {
  NOTIFICATIONS_FALLBACK_LINK,
  collectionLink,
  ingestReviewLink,
  safeDeepLink,
} from './deepLinks';
import type {
  ClaimedOutboxEvent,
  MaterializeRender,
  NotificationCategory,
  NotificationEventType,
} from './types';

export class InvalidNotificationPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNotificationPayloadError';
  }
}

type Payload = Record<string, unknown>;

type RenderedText = {
  title: string;
  body: string;
  deepLink: string;
  data: Record<string, unknown>;
};

export type NotificationTypeDefinition = {
  category: NotificationCategory;
  requiresActor: boolean;
  /** Aggregation window; null = never aggregated. */
  groupWindowSeconds: number | null;
  groupKey?: (event: { recipientUserId: string; payload: Payload }) => string;
  /** Stored text must never include actor names (they are resolved at read/send time). */
  render: (payload: Payload) => RenderedText;
};

const HOUR = 3_600;
const TITLE_MAX = 120;
const BODY_MAX = 400;

function requireString(payload: Payload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidNotificationPayloadError(`payload.${key} is required`);
  }
  return value.trim();
}

function optionalString(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function quoted(text: string | null, max = 80): string | null {
  if (!text) return null;
  const clipped = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return `“${clipped}”`;
}

function providerLabel(provider: string | null): string {
  if (provider === 'youtube') return 'YouTube';
  if (provider === 'instagram') return 'Instagram';
  return 'connected';
}

export const NOTIFICATION_TYPES: Record<NotificationEventType, NotificationTypeDefinition> = {
  'collection.publish_succeeded': {
    category: 'task',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const collectionId = requireString(payload, 'collectionId');
      const name = quoted(optionalString(payload, 'collectionTitle'));
      return {
        title: 'Your Collection is live',
        body: name ? `${name} is now published.` : 'Your Collection is now published.',
        deepLink: collectionLink(collectionId),
        data: { collectionId },
      };
    },
  },
  'collection.publish_failed': {
    category: 'task',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const ingestId = requireString(payload, 'ingestId');
      const collectionId = optionalString(payload, 'collectionId');
      return {
        title: 'Publishing didn’t finish',
        body: 'Open your draft to try again.',
        deepLink: ingestReviewLink(ingestId),
        data: { ingestId, collectionId },
      };
    },
  },
  'ingest.ready_for_review': {
    category: 'task',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const ingestId = requireString(payload, 'ingestId');
      const name = quoted(optionalString(payload, 'videoTitle'));
      const found = payload.productCount !== 0;
      if (!found) {
        return {
          title: 'Your draft is ready',
          body: name
            ? `We couldn’t spot products in ${name}. Add them before publishing.`
            : 'We couldn’t spot products in your video. Add them before publishing.',
          deepLink: ingestReviewLink(ingestId),
          data: { ingestId },
        };
      }
      return {
        title: 'Products ready to review',
        body: name
          ? `We found products in ${name}. Review them before publishing.`
          : 'We found products in your video. Review them before publishing.',
        deepLink: ingestReviewLink(ingestId),
        data: { ingestId },
      };
    },
  },
  'ingest.failed': {
    category: 'task',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const ingestId = requireString(payload, 'ingestId');
      return {
        title: 'We couldn’t finish finding products',
        body: 'Open your draft to add products manually or try again.',
        deepLink: ingestReviewLink(ingestId),
        data: { ingestId },
      };
    },
  },
  'creator_library.sync_failed': {
    category: 'account',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const connectedAccountId = requireString(payload, 'connectedAccountId');
      const provider = optionalString(payload, 'provider');
      return {
        title: 'Library sync didn’t finish',
        body: `We couldn’t sync your ${providerLabel(provider)} library. You can try again from Create.`,
        deepLink: safeDeepLink('/settings'),
        data: { connectedAccountId, provider },
      };
    },
  },
  'connected_account.needs_reauth': {
    category: 'account',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const connectedAccountId = requireString(payload, 'connectedAccountId');
      const provider = optionalString(payload, 'provider');
      return {
        title: 'Reconnect your account',
        body: `Your ${providerLabel(provider)} connection needs to be renewed to keep syncing.`,
        deepLink: safeDeepLink('/settings'),
        data: { connectedAccountId, provider },
      };
    },
  },
  'creator.status_changed': {
    category: 'account',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const status = requireString(payload, 'status');
      const from = optionalString(payload, 'from');
      const body =
        status === 'ACTIVE' && from === 'SUSPENDED'
          ? 'Your creator access has been restored.'
          : status === 'ACTIVE'
            ? 'You’re now a Mystash creator.'
            : status === 'SUSPENDED'
              ? 'Your creator access has been paused. Open Settings for details.'
              : 'Your creator status was updated.';
      return {
        title: 'Creator status updated',
        body,
        deepLink: safeDeepLink('/settings'),
        data: { status },
      };
    },
  },
  'creator.followed': {
    category: 'social',
    requiresActor: true,
    groupWindowSeconds: HOUR,
    groupKey: ({ recipientUserId }) => `creator.followed:${recipientUserId}`,
    render() {
      return {
        title: 'New follower',
        body: 'Someone followed you.',
        deepLink: NOTIFICATIONS_FALLBACK_LINK,
        data: {},
      };
    },
  },
  'collection.saved': {
    category: 'social',
    requiresActor: true,
    groupWindowSeconds: HOUR,
    groupKey: ({ payload }) => `collection.saved:${requireString(payload, 'collectionId')}`,
    render(payload) {
      const collectionId = requireString(payload, 'collectionId');
      return {
        title: 'Collection saved',
        body: 'Someone saved your Collection.',
        deepLink: collectionLink(collectionId),
        data: { collectionId },
      };
    },
  },
  'reel.liked': {
    category: 'social',
    requiresActor: true,
    groupWindowSeconds: HOUR,
    groupKey: ({ payload }) => `reel.liked:${requireString(payload, 'collectionId')}`,
    render(payload) {
      const collectionId = requireString(payload, 'collectionId');
      return {
        title: 'New like',
        body: 'Someone liked your Reel.',
        deepLink: collectionLink(collectionId),
        data: { collectionId },
      };
    },
  },
  'promo.broadcast': {
    category: 'promo',
    requiresActor: false,
    groupWindowSeconds: null,
    render(payload) {
      const campaignId = requireString(payload, 'campaignId');
      const title = requireString(payload, 'title');
      const body = requireString(payload, 'body');
      const deepLink = optionalString(payload, 'deepLink');
      return {
        title: clip(title, TITLE_MAX),
        body: clip(body, BODY_MAX),
        deepLink: safeDeepLink(deepLink),
        data: { campaignId },
      };
    },
  },
};

export function isNotificationEventType(value: string): value is NotificationEventType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, value);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Throws InvalidNotificationPayloadError for unknown types or bad payloads (non-retryable). */
export function buildMaterializeRender(
  event: Pick<ClaimedOutboxEvent, 'eventType' | 'recipientUserId' | 'payload'>,
): MaterializeRender {
  if (!isNotificationEventType(event.eventType)) {
    throw new InvalidNotificationPayloadError(`unknown event type ${event.eventType}`);
  }
  const def = NOTIFICATION_TYPES[event.eventType];
  const text = def.render(event.payload);
  const groupKey = def.groupWindowSeconds !== null && def.groupKey ? def.groupKey(event) : null;
  return {
    type: event.eventType,
    category: def.category,
    title: clip(text.title, TITLE_MAX),
    body: clip(text.body, BODY_MAX),
    data: text.data,
    deep_link: safeDeepLink(text.deepLink),
    group_key: groupKey,
    group_window_seconds: groupKey ? def.groupWindowSeconds : null,
    requires_actor: def.requiresActor,
    expires_at: null,
  };
}
