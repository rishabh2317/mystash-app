import { logger } from '../../logger';
import type { NotificationRepository } from '../NotificationRepository';
import { buildMaterializeRender, InvalidNotificationPayloadError } from '../domain/eventTypes';
import { HEALTH_THRESHOLDS, OUTBOX_LAG_POLICY, OUTBOX_POLICY, outboxRetrySeconds } from '../domain/policy';
import { buildMaterializePush } from '../domain/pushPolicy';
import type { ClaimedOutboxEvent } from '../domain/types';

export type MaterializerStats = {
  lastRunAt: string | null;
  lastMaterializedAt: string | null;
  lastError: string | null;
};

/** pushEnabled=false keeps the Phase 1 three-argument materialize call (works without the Phase 4 migration). */
export type MaterializerOptions = { pushEnabled?: boolean; batchRpc?: boolean };

export type MaterializerPolicy = {
  claimBatch: number;
  leaseSeconds: number;
  maxClaims: number;
  concurrency: number;
  idlePollMs?: number;
};

export async function resolveOutboxPolicy(
  repo: NotificationRepository,
  now: () => number = () => Date.now(),
): Promise<{ policy: MaterializerPolicy; batchRpc: boolean; lagSeconds: number | null }> {
  const snapshot = await repo.healthSnapshot();
  const lagSeconds = snapshot.outboxOldestDueCreatedAt
    ? Math.max(0, Math.round((now() - Date.parse(snapshot.outboxOldestDueCreatedAt)) / 1000))
    : null;
  const behind = lagSeconds !== null && lagSeconds > HEALTH_THRESHOLDS.outboxLagSeconds;
  return {
    policy: behind ? OUTBOX_LAG_POLICY : OUTBOX_POLICY,
    batchRpc: behind,
    lagSeconds,
  };
}

async function processOne(
  repo: NotificationRepository,
  event: ClaimedOutboxEvent,
  options: MaterializerOptions,
): Promise<void> {
  let render;
  try {
    render = buildMaterializeRender(event);
  } catch (err) {
    if (err instanceof InvalidNotificationPayloadError) {
      await repo.failOutbox(event.outboxId, event.leaseToken, `invalid_payload: ${err.message}`, 0, 1);
      logger.warn({ outboxId: event.outboxId, eventType: event.eventType }, 'notification.outbox.invalid_payload');
      return;
    }
    throw err;
  }

  try {
    const push = options.pushEnabled ? buildMaterializePush(render.category) : null;
    const { outcome } = await repo.materialize(event.outboxId, event.leaseToken, render, push);
    if (outcome === 'lease_lost') {
      logger.info({ outboxId: event.outboxId }, 'notification.outbox.lease_lost');
    }
  } catch (err) {
    const message = (err as Error).message ?? 'materialize failed';
    const outcome = await repo
      .failOutbox(
        event.outboxId,
        event.leaseToken,
        message,
        outboxRetrySeconds(event.claimCount),
        OUTBOX_POLICY.maxFailures,
      )
      .catch(() => 'lease_lost' as const);
    logger.warn(
      { outboxId: event.outboxId, eventType: event.eventType, outcome, message: message.slice(0, 200) },
      'notification.outbox.materialize_failed',
    );
  }
}

async function materializeBatchRpc(
  repo: NotificationRepository,
  batch: ClaimedOutboxEvent[],
  options: MaterializerOptions,
): Promise<void> {
  const items: {
    outboxId: string;
    leaseToken: string;
    render: ReturnType<typeof buildMaterializeRender>;
    push?: ReturnType<typeof buildMaterializePush> | null;
  }[] = [];
  for (const event of batch) {
    try {
      const render = buildMaterializeRender(event);
      items.push({
        outboxId: event.outboxId,
        leaseToken: event.leaseToken,
        render,
        push: options.pushEnabled ? buildMaterializePush(render.category) : null,
      });
    } catch (err) {
      if (err instanceof InvalidNotificationPayloadError) {
        await repo.failOutbox(event.outboxId, event.leaseToken, `invalid_payload: ${err.message}`, 0, 1);
        continue;
      }
      throw err;
    }
  }
  if (items.length === 0) return;
  await repo.materializeMany(items);
}

/** Claims one batch and materializes it with bounded concurrency; returns the batch size. */
export async function runMaterializerOnce(
  repo: NotificationRepository,
  policy: MaterializerPolicy = OUTBOX_POLICY,
  options: MaterializerOptions = {},
): Promise<number> {
  const batch = await repo.claimOutbox(policy.claimBatch, policy.leaseSeconds, policy.maxClaims);
  if (options.batchRpc) {
    await materializeBatchRpc(repo, batch, options);
    return batch.length;
  }
  let next = 0;
  const workers = Array.from({ length: Math.min(policy.concurrency, batch.length) }, async () => {
    while (next < batch.length) {
      const event = batch[next++];
      await processOne(repo, event, options);
    }
  });
  await Promise.all(workers);
  return batch.length;
}

export type MaterializerHandle = { stop(): Promise<void>; stats(): MaterializerStats };

/** DB-only loop: needs Postgres, never Redis. */
export function startOutboxMaterializer(
  repo: NotificationRepository,
  options: MaterializerOptions = {},
): MaterializerHandle {
  const stats: MaterializerStats = { lastRunAt: null, lastMaterializedAt: null, lastError: null };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    let claimed = 0;
    let idlePollMs: number = OUTBOX_POLICY.idlePollMs;
    let claimBatch: number = OUTBOX_POLICY.claimBatch;
    try {
      const resolved = await resolveOutboxPolicy(repo);
      if (resolved.batchRpc) {
        logger.warn({ lagSeconds: resolved.lagSeconds }, 'notification.materializer.lag_boost');
      }
      claimed = await runMaterializerOnce(repo, resolved.policy, { ...options, batchRpc: resolved.batchRpc });
      idlePollMs = resolved.policy.idlePollMs ?? OUTBOX_POLICY.idlePollMs;
      claimBatch = resolved.policy.claimBatch;
      stats.lastRunAt = new Date().toISOString();
      if (claimed > 0) stats.lastMaterializedAt = stats.lastRunAt;
      stats.lastError = null;
    } catch (err) {
      stats.lastError = ((err as Error).message ?? 'unknown').slice(0, 200);
      logger.warn({ message: stats.lastError }, 'notification.materializer.loop_failed');
    }
    if (stopped) return;
    const delay = claimed >= claimBatch ? 0 : idlePollMs;
    timer = setTimeout(() => {
      running = loop();
    }, delay);
  };

  running = loop();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
    stats: () => ({ ...stats }),
  };
}
