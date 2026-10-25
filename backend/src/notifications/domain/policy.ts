const DAY_SECONDS = 86_400;

export const NOTIFICATION_RETENTION = {
  /** Enqueue rejects events whose source timestamp is older than this. */
  staleAfterDays: 30,
  /** Must exceed staleAfterDays so a pruned key can never re-admit a replayed event. */
  eventKeyDays: 120,
  inboxDays: 90,
  outboxProcessedDays: 7,
  outboxDeadDays: 30,
} as const;

export const STALE_AFTER_SECONDS = NOTIFICATION_RETENTION.staleAfterDays * DAY_SECONDS;

export const OUTBOX_POLICY = {
  claimBatch: 100,
  leaseSeconds: 60,
  maxClaims: 10,
  maxFailures: 8,
  idlePollMs: 1_000,
  concurrency: 8,
} as const;

/** Used when due-outbox lag exceeds HEALTH_THRESHOLDS.outboxLagSeconds. */
export const OUTBOX_LAG_POLICY: MaterializerPolicyShape = {
  claimBatch: 500,
  leaseSeconds: 60,
  maxClaims: 10,
  maxFailures: OUTBOX_POLICY.maxFailures,
  idlePollMs: 0,
  concurrency: 32,
};

type MaterializerPolicyShape = {
  claimBatch: number;
  leaseSeconds: number;
  maxClaims: number;
  maxFailures: number;
  idlePollMs: number;
  concurrency: number;
};

export const CAMPAIGN_FANOUT = {
  batch: 1_000,
  batchMax: 5_000,
  idlePollMs: 2_000,
} as const;

/** Worker health / lag-boost thresholds (plan section 9). */
export const HEALTH_THRESHOLDS = {
  outboxLagSeconds: 120,
  materializerStaleSeconds: 30,
  pushLagSeconds: 120,
  dispatcherStaleSeconds: 30,
  outboxDeadCapped: 100,
} as const;

export const SWEEP_POLICY = {
  intervalMs: 30_000,
  batch: 1_000,
  purgeRetryIntervalMs: 10 * 60_000,
  purgeRetryLookbackDays: 7,
  purgeRetryMaxUsers: 200,
} as const;

export const PRUNE_POLICY = {
  intervalMs: 60 * 60_000,
  batch: 2_000,
} as const;

export const PURGE_BATCH = 1_000;

export function assertRetentionInvariant(): void {
  if (NOTIFICATION_RETENTION.eventKeyDays <= NOTIFICATION_RETENTION.staleAfterDays) {
    throw new Error('notification event key retention must exceed the stale cutoff');
  }
}

/** Exponential backoff with ±20% jitter, capped at 15 minutes. */
export function outboxRetrySeconds(failureCount: number, random: () => number = Math.random): number {
  const base = Math.min(15 * 60, 5 * 2 ** Math.max(0, failureCount));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.max(1, Math.round(base * jitter));
}
