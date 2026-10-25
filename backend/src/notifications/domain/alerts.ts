import type { NotificationHealthReport } from '../health';

export type NotificationAlert = {
  code: string;
  severity: 'warn' | 'page';
  detail: string;
};

export const ALERT_THRESHOLDS = {
  stuckSendingCapped: 10,
  receiptsOverdueCapped: 100,
} as const;

/** Maps the health report onto page/warn alerts. Callers log `notification.alert`. */
export function evaluateNotificationAlerts(report: NotificationHealthReport): NotificationAlert[] {
  const alerts: NotificationAlert[] = [];
  for (const reason of report.reasons) {
    alerts.push({
      code: `notification.${reason}`,
      severity: reason.endsWith('_stale') || reason.endsWith('_lag') ? 'page' : 'warn',
      detail: `${reason} (lag=${report.outboxLagSeconds ?? 'n/a'}s)`,
    });
  }
  const stuck = report.push?.stuckSendingCountCapped ?? 0;
  if (stuck >= ALERT_THRESHOLDS.stuckSendingCapped) {
    alerts.push({
      code: 'notification.push_stuck_sending',
      severity: 'page',
      detail: `stuck sending capped at ${stuck}`,
    });
  }
  const overdue = report.push?.receiptsOverdueCountCapped ?? 0;
  if (overdue >= ALERT_THRESHOLDS.receiptsOverdueCapped) {
    alerts.push({
      code: 'notification.push_receipts_overdue',
      severity: 'warn',
      detail: `overdue receipts capped at ${overdue}`,
    });
  }
  return alerts;
}

const lastFired = new Map<string, number>();
export const ALERT_COOLDOWN_MS = 60_000;

export function resetAlertCooldowns(): void {
  lastFired.clear();
}

export function alertsDue(
  alerts: NotificationAlert[],
  now: number,
  cooldownMs: number = ALERT_COOLDOWN_MS,
  fired: Map<string, number> = lastFired,
): NotificationAlert[] {
  const due: NotificationAlert[] = [];
  for (const alert of alerts) {
    const prev = fired.get(alert.code);
    if (prev === undefined || now - prev >= cooldownMs) {
      fired.set(alert.code, now);
      due.push(alert);
    }
  }
  return due;
}
