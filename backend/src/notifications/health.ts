import type { NotificationRepository } from './NotificationRepository';
import type { MaterializerStats } from './jobs/outboxMaterializer';
import type { MaintenanceStats } from './jobs/notificationMaintenance';
import type { DispatcherStats } from './jobs/pushDispatcher';
import type { ReceiptPollerStats } from './jobs/receiptPoller';
import { HEALTH_THRESHOLDS } from './domain/policy';

export { HEALTH_THRESHOLDS };

export type NotificationHealthReport = {
  status: 'ok' | 'degraded';
  reasons: string[];
  outboxLagSeconds: number | null;
  outboxDueCountCapped: number;
  outboxDeadCountCapped: number;
  push?: {
    lagSeconds: number | null;
    stuckSendingCountCapped: number;
    receiptsOverdueCountCapped: number;
  };
  materializer?: MaterializerStats;
  maintenance?: MaintenanceStats;
  dispatcher?: DispatcherStats;
  receipts?: ReceiptPollerStats;
};

function secondsSince(iso: string | null | undefined, now: number): number | null {
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
}

export async function buildNotificationHealthReport(
  repo: NotificationRepository,
  runtime: {
    materializer?: MaterializerStats;
    maintenance?: MaintenanceStats;
    dispatcher?: DispatcherStats;
    receipts?: ReceiptPollerStats;
  } = {},
  now: () => number = () => Date.now(),
): Promise<NotificationHealthReport> {
  const snapshot = await repo.healthSnapshot();
  const reasons: string[] = [];
  const lag = secondsSince(snapshot.outboxOldestDueCreatedAt, now());
  if (lag !== null && lag > HEALTH_THRESHOLDS.outboxLagSeconds) reasons.push('outbox_lag');
  if (snapshot.outboxDeadCountCapped >= HEALTH_THRESHOLDS.outboxDeadCapped) reasons.push('outbox_dead');
  if (runtime.materializer) {
    const lastRun = runtime.materializer.lastRunAt ? Date.parse(runtime.materializer.lastRunAt) : null;
    if (lastRun === null || now() - lastRun > HEALTH_THRESHOLDS.materializerStaleSeconds * 1000) {
      reasons.push('materializer_stale');
    }
  }

  let push: NotificationHealthReport['push'];
  if (runtime.dispatcher) {
    const pushLag = secondsSince(snapshot.pushOldestDueAvailableAt, now());
    if (pushLag !== null && pushLag > HEALTH_THRESHOLDS.pushLagSeconds) reasons.push('push_lag');
    const lastRun = runtime.dispatcher.lastRunAt ? Date.parse(runtime.dispatcher.lastRunAt) : null;
    if (lastRun === null || now() - lastRun > HEALTH_THRESHOLDS.dispatcherStaleSeconds * 1000) {
      reasons.push('dispatcher_stale');
    }
    push = {
      lagSeconds: pushLag,
      stuckSendingCountCapped: snapshot.pushStuckSendingCountCapped ?? 0,
      receiptsOverdueCountCapped: snapshot.pushReceiptsOverdueCountCapped ?? 0,
    };
  }

  return {
    status: reasons.length ? 'degraded' : 'ok',
    reasons,
    outboxLagSeconds: lag,
    outboxDueCountCapped: snapshot.outboxDueCountCapped,
    outboxDeadCountCapped: snapshot.outboxDeadCountCapped,
    ...(push ? { push } : {}),
    ...runtime,
  };
}
