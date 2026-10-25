import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertsDue, ALERT_COOLDOWN_MS, evaluateNotificationAlerts } from './alerts';
import type { NotificationHealthReport } from '../health';

function report(patch: Partial<NotificationHealthReport> = {}): NotificationHealthReport {
  return {
    status: 'ok',
    reasons: [],
    outboxLagSeconds: null,
    outboxDueCountCapped: 0,
    outboxDeadCountCapped: 0,
    ...patch,
  };
}

describe('notification alerts', () => {
  it('pages on lag/stale and warns on dead outbox', () => {
    const alerts = evaluateNotificationAlerts(
      report({
        status: 'degraded',
        reasons: ['outbox_lag', 'outbox_dead', 'materializer_stale'],
        outboxLagSeconds: 180,
      }),
    );
    assert.deepEqual(
      alerts.map((a) => [a.code, a.severity]),
      [
        ['notification.outbox_lag', 'page'],
        ['notification.outbox_dead', 'warn'],
        ['notification.materializer_stale', 'page'],
      ],
    );
  });

  it('pages when stuck sending is capped and warns on overdue receipts', () => {
    const alerts = evaluateNotificationAlerts(
      report({
        push: { lagSeconds: 10, stuckSendingCountCapped: 10, receiptsOverdueCountCapped: 100 },
      }),
    );
    assert.equal(alerts.find((a) => a.code === 'notification.push_stuck_sending')?.severity, 'page');
    assert.equal(alerts.find((a) => a.code === 'notification.push_receipts_overdue')?.severity, 'warn');
  });

  it('cools down duplicate alert codes for 60s', () => {
    const fired = new Map<string, number>();
    const alerts = evaluateNotificationAlerts(report({ status: 'degraded', reasons: ['outbox_lag'] }));
    assert.equal(alertsDue(alerts, 1_000, ALERT_COOLDOWN_MS, fired).length, 1);
    assert.equal(alertsDue(alerts, 1_000 + ALERT_COOLDOWN_MS - 1, ALERT_COOLDOWN_MS, fired).length, 0);
    assert.equal(alertsDue(alerts, 1_000 + ALERT_COOLDOWN_MS, ALERT_COOLDOWN_MS, fired).length, 1);
  });
});
