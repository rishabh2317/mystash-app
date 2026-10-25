import 'dotenv/config';
import { getEnv } from './env';
import { logger } from './logger';
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, startNotificationWorker } from './notifications/jobs/startNotificationWorker';
import { createSupabaseAdmin } from './supabase';

const healthPort = Number(getEnv('NOTIFICATIONS_WORKER_HEALTH_PORT') ?? getEnv('WORKER_HEALTH_PORT') ?? 0);
const shutdownTimeoutMs = Number(getEnv('NOTIFICATIONS_WORKER_SHUTDOWN_MS') ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);

const notificationWorker = startNotificationWorker(createSupabaseAdmin(), { healthPort });
logger.info('mystash notification worker running (postgres only)');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'notification worker draining');
  const hardExit = setTimeout(() => process.exit(1), shutdownTimeoutMs + 5_000) as unknown as { unref?: () => void };
  hardExit.unref?.();
  const { drained } = await notificationWorker.close(shutdownTimeoutMs);
  logger.info({ drained }, 'notification worker stopped');
  process.exit(drained ? 0 : 1);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
