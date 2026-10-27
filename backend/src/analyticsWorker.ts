import 'dotenv/config';
import { startAnalyticsMaintenance } from './analytics/worker';
import { startEngagementReconciliation } from './engagement/reconciliationWorker';
import { logger } from './logger';
import { createSupabaseAdmin } from './supabase';

// Deploy analytics independently without starting ingestion, AI, notification or library jobs.
const admin = createSupabaseAdmin();
const maintenance = startAnalyticsMaintenance(admin, { keepAlive: true });
const reconciliation = startEngagementReconciliation(admin, { keepAlive: true });
logger.info('analytics.worker_started');

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  maintenance.close();
  reconciliation.close();
  // Let the existing bounded requests finish; do not force-exit a live transaction.
  logger.info('analytics.worker_stopping');
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
