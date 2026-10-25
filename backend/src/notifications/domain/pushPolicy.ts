import type { NotificationCategory } from './types';

const HOUR = 3_600;
const DAY = 24 * HOUR;

export type PushRetryPolicy = 'retry_ambiguous_once' | 'no_ambiguous_retry';

export type CategoryPushPolicy = {
  ttlSeconds: number;
  retryPolicy: PushRetryPolicy;
  /** 0 = no per-group cooldown. */
  cooldownSeconds: number;
  /** null = uncapped (task and account are never capped). */
  rateCap: number | null;
  rateWindowSeconds: number;
};

/** Accepted decisions (plan section 12, decisions 3 and 4). */
export const PUSH_CATEGORY_POLICY: Record<NotificationCategory, CategoryPushPolicy> = {
  social: { ttlSeconds: 6 * HOUR, retryPolicy: 'no_ambiguous_retry', cooldownSeconds: DAY, rateCap: 10, rateWindowSeconds: DAY },
  task: { ttlSeconds: DAY, retryPolicy: 'retry_ambiguous_once', cooldownSeconds: 0, rateCap: null, rateWindowSeconds: DAY },
  account: { ttlSeconds: DAY, retryPolicy: 'retry_ambiguous_once', cooldownSeconds: 0, rateCap: null, rateWindowSeconds: DAY },
  security: { ttlSeconds: HOUR, retryPolicy: 'retry_ambiguous_once', cooldownSeconds: 0, rateCap: null, rateWindowSeconds: DAY },
  promo: { ttlSeconds: DAY, retryPolicy: 'no_ambiguous_retry', cooldownSeconds: 0, rateCap: null, rateWindowSeconds: DAY },
};

/** Bounded attempts for known-retryable outcomes (429 / 5xx); ambiguous retries are counted separately. */
export const MAX_SEND_ATTEMPTS = 3;

export const PUSH_DISPATCH_POLICY = {
  provider: 'expo',
  claimBatch: 100,
  leaseSeconds: 60,
  sendLeaseSeconds: 120,
  maxClaims: 10,
  idlePollMs: 2_000,
  requestTimeoutMs: 30_000,
} as const;

export const RECEIPT_POLICY = {
  provider: 'expo',
  claimBatch: 1_000,
  leaseSeconds: 120,
  pollIntervalMs: 60_000,
} as const;

/** Matches the migration's p_delivery_days default. */
export const DELIVERY_RETENTION_DAYS = 30;

/** Expo / APNs / FCM payload limit. */
export const PUSH_PAYLOAD_MAX_BYTES = 4_096;

/** `p_push` for notification_materialize. */
export type MaterializePush = {
  enabled: boolean;
  ttl_seconds: number;
  retry_policy: PushRetryPolicy;
  max_send_attempts: number;
  cooldown_seconds: number;
  rate_cap: number | null;
  rate_window_seconds: number;
  provider_preference: string[];
};

export function buildMaterializePush(category: NotificationCategory): MaterializePush {
  const policy = PUSH_CATEGORY_POLICY[category];
  return {
    enabled: true,
    ttl_seconds: policy.ttlSeconds,
    retry_policy: policy.retryPolicy,
    max_send_attempts: MAX_SEND_ATTEMPTS,
    cooldown_seconds: policy.cooldownSeconds,
    rate_cap: policy.rateCap,
    rate_window_seconds: policy.rateWindowSeconds,
    provider_preference: ['expo'],
  };
}
