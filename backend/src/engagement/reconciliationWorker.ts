import { setInterval,clearInterval } from 'node:timers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { analyticsRpc } from '../analytics/rpc';

/** SQL lease/rate gate coordinates replicas; durable reports expire after 30 days. */
export function startEngagementReconciliation(admin: SupabaseClient): { close(): void } {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const { data, error } = await analyticsRpc(admin,'engagement_check_and_record');
      if (error) logger.warn({ code: error.code }, 'engagement.reconciliation_failed');
      else if (data) {
        const mismatch = Number(data.collection_mismatches) + Number(data.user_mismatches);
        if (mismatch > 0) logger.warn(data, 'engagement.reconciliation_drift');
        else logger.info(data, 'engagement.reconciliation_ok');
      }
    } catch {
      logger.warn('engagement.reconciliation_unavailable');
    } finally { running = false; }
  };
  void check();
  const timer = setInterval(() => void check(), 60 * 60 * 1000);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
