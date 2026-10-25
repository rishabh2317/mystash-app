import { createServer, type Server } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logger';
import { createNotificationRepository, createPushRepository } from '../factory';
import { buildNotificationHealthReport } from '../health';
import type { NotificationRepository } from '../NotificationRepository';
import { NotificationService } from '../NotificationService';
import { ExpoPushProvider } from '../providers/ExpoPushProvider';
import type { PushProvider } from '../providers/types';
import { resolvePushConfig, type PushConfig } from '../pushConfig';
import type { PushRepository } from '../PushRepository';
import { alertsDue, evaluateNotificationAlerts } from '../domain/alerts';
import { startCampaignFanOut } from './campaignFanOut';
import { startNotificationMaintenance } from './notificationMaintenance';
import { startOutboxMaterializer } from './outboxMaterializer';
import { startPushDispatcher, type DispatcherHandle } from './pushDispatcher';
import { startReceiptPoller, type ReceiptPollerHandle } from './receiptPoller';

export type NotificationWorkerHandle = {
  /** Stops claiming, drains in-flight work, closes the health server. Bounded by `timeoutMs`. */
  close(timeoutMs?: number): Promise<{ drained: boolean }>;
  readonly pushEnabled: boolean;
};

export type NotificationWorkerOptions = {
  /** Serve `GET /health` on this port (internal only). */
  healthPort?: number | null;
  repo?: NotificationRepository;
  /** Defaults to the environment; throws when push is enabled without EXPO_ACCESS_TOKEN. */
  push?: PushConfig;
  pushRepo?: PushRepository;
  pushProvider?: PushProvider;
};

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

/** Postgres-only: the materializer, sweeper, prune, purge retry and push dispatch never touch Redis. */
export function startNotificationWorker(
  admin: SupabaseClient | null,
  options: NotificationWorkerOptions = {},
): NotificationWorkerHandle {
  const push = options.push ?? resolvePushConfig();
  const repo = options.repo ?? createNotificationRepository(admin as SupabaseClient);
  const service = new NotificationService(repo);
  const materializer = startOutboxMaterializer(repo, { pushEnabled: push.enabled });
  const maintenance = startNotificationMaintenance(repo, service);
  const campaigns = startCampaignFanOut(service);

  let dispatcher: DispatcherHandle | null = null;
  let receipts: ReceiptPollerHandle | null = null;
  if (push.enabled) {
    const pushRepo = options.pushRepo ?? createPushRepository(admin as SupabaseClient);
    const provider = options.pushProvider ?? new ExpoPushProvider({ accessToken: push.expoAccessToken });
    dispatcher = startPushDispatcher(pushRepo, provider);
    receipts = startReceiptPoller(pushRepo, provider);
  }
  logger.info({ pushEnabled: push.enabled }, 'notification worker started');
  let draining = false;

  let server: Server | null = null;
  const port = options.healthPort;
  if (port && Number.isInteger(port) && port > 0) {
    server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      if (draining) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ notifications: { status: 'draining', reasons: ['shutting_down'] } }));
        return;
      }
      buildNotificationHealthReport(repo, {
        materializer: materializer.stats(),
        maintenance: maintenance.stats(),
        ...(dispatcher ? { dispatcher: dispatcher.stats() } : {}),
        ...(receipts ? { receipts: receipts.stats() } : {}),
      })
        .then((report) => {
          for (const alert of alertsDue(evaluateNotificationAlerts(report), Date.now())) {
            logger.error({ code: alert.code, detail: alert.detail, severity: alert.severity }, 'notification.alert');
          }
          res.writeHead(report.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ notifications: report }));
        })
        .catch(() => {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ notifications: { status: 'degraded', reasons: ['db_unavailable'] } }));
        });
    });
    server.listen(port, () => logger.info({ port }, 'notification worker health server listening'));
  }

  return {
    pushEnabled: push.enabled,
    async close(timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
      draining = true;
      maintenance.stop();
      campaigns.stop();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      // Unfinished leases expire and are reclaimed by the next process; an interrupted send is
      // resolved by the sweeper's ambiguous rule. Nothing is lost.
      const drained = await Promise.race([
        Promise.all([materializer.stop(), dispatcher?.stop(), receipts?.stop()]).then(() => true as const),
        timedOut,
      ]);
      clearTimeout(timer);
      if (server) {
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      return { drained };
    },
  };
}
