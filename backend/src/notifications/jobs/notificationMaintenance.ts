import { logger } from '../../logger';
import type { NotificationRepository } from '../NotificationRepository';
import type { NotificationService } from '../NotificationService';
import {
  NOTIFICATION_RETENTION,
  OUTBOX_POLICY,
  PRUNE_POLICY,
  SWEEP_POLICY,
  assertRetentionInvariant,
} from '../domain/policy';

export type MaintenanceStats = {
  lastSweepAt: string | null;
  lastPruneAt: string | null;
  lastPurgeRetryAt: string | null;
};

export async function runSweepOnce(repo: NotificationRepository): Promise<number> {
  const result = await repo.sweep(OUTBOX_POLICY.maxClaims, SWEEP_POLICY.batch);
  if (result.outboxDead > 0) logger.warn({ outboxDead: result.outboxDead }, 'notification.outbox.claim_limit_exhausted');
  if (result.deliveriesFailedDispatch) {
    logger.warn({ deliveries: result.deliveriesFailedDispatch }, 'notification.push.dispatch_exhausted');
  }
  if (result.deliveriesExpired || result.sendingAbandoned) {
    logger.info(
      { deliveriesExpired: result.deliveriesExpired ?? 0, sendingAbandoned: result.sendingAbandoned ?? 0 },
      'notification.push.sweep',
    );
  }
  return result.outboxDead;
}

/** Loops batches until every table is under its retention window. */
export async function runPruneOnce(repo: NotificationRepository, maxRounds = 50): Promise<void> {
  assertRetentionInvariant();
  for (let round = 0; round < maxRounds; round += 1) {
    const result = await repo.prune({
      batch: PRUNE_POLICY.batch,
      outboxProcessedDays: NOTIFICATION_RETENTION.outboxProcessedDays,
      outboxDeadDays: NOTIFICATION_RETENTION.outboxDeadDays,
      eventKeyDays: NOTIFICATION_RETENTION.eventKeyDays,
      staleAfterDays: NOTIFICATION_RETENTION.staleAfterDays,
      inboxDays: NOTIFICATION_RETENTION.inboxDays,
    });
    const busiest = Math.max(
      result.outboxProcessed,
      result.outboxDead,
      result.eventKeys,
      result.notifications,
      result.deliveries ?? 0,
      result.registrations ?? 0,
    );
    if (busiest > 0) logger.info(result, 'notification.prune.batch');
    if (busiest < PRUNE_POLICY.batch) return;
  }
}

/** Re-runs the idempotent purge for recently soft-deleted accounts (covers a failed deleteAccount hook). */
export async function runPurgeRetryOnce(
  repo: NotificationRepository,
  service: NotificationService,
  now: () => number = () => Date.now(),
): Promise<number> {
  const since = new Date(now() - SWEEP_POLICY.purgeRetryLookbackDays * 86_400_000).toISOString();
  const userIds = await repo.listRecentlyDeletedUserIds(since, SWEEP_POLICY.purgeRetryMaxUsers);
  for (const userId of userIds) {
    await service.purgeUser(userId);
  }
  return userIds.length;
}

export type MaintenanceHandle = { stop(): void; stats(): MaintenanceStats };

export function startNotificationMaintenance(
  repo: NotificationRepository,
  service: NotificationService,
): MaintenanceHandle {
  const stats: MaintenanceStats = { lastSweepAt: null, lastPruneAt: null, lastPurgeRetryAt: null };
  const guard = (name: string, fn: () => Promise<unknown>, onOk: () => void) => {
    let busy = false;
    return () => {
      if (busy) return;
      busy = true;
      fn()
        .then(onOk)
        .catch((err) =>
          logger.warn({ message: (err as Error).message?.slice(0, 200) }, `notification.${name}.failed`),
        )
        .finally(() => {
          busy = false;
        });
    };
  };
  const sweep = guard('sweep', () => runSweepOnce(repo), () => {
    stats.lastSweepAt = new Date().toISOString();
  });
  const prune = guard('prune', () => runPruneOnce(repo), () => {
    stats.lastPruneAt = new Date().toISOString();
  });
  const purgeRetry = guard('purge_retry', () => runPurgeRetryOnce(repo, service), () => {
    stats.lastPurgeRetryAt = new Date().toISOString();
  });

  const timers = [
    setInterval(sweep, SWEEP_POLICY.intervalMs),
    setInterval(prune, PRUNE_POLICY.intervalMs),
    setInterval(purgeRetry, SWEEP_POLICY.purgeRetryIntervalMs),
  ];
  sweep();
  return {
    stop: () => timers.forEach(clearInterval),
    stats: () => ({ ...stats }),
  };
}
