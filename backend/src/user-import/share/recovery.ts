import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../../env';
import { logger } from '../../logger';
import { createContentSourceService } from '../../content-source/factory';
import { createUserImportBagSync } from '../../content-source/processing/userImportBagSync';
import { SupabaseUserImportRepository } from '../SupabaseUserImportRepository';
import { enqueueContentSourceProcessing, getContentSourceProcessingQueue } from '../../content-source/jobs/contentSourceQueue';
import { contentSourceProcessingJobId } from '../../content-source/jobs/jobIdentity';
import { syncImportPlaces } from '../../place/syncImportPlaces';
import { SupabasePlaceRepository } from '../../place/SupabasePlaceRepository';

/** Runs only inside an existing consumer. Atomic bounded claims fence API replicas. */
export async function dispatchAcceptedShares(db: SupabaseClient): Promise<number> {
  const lease = randomUUID();
  const { data, error } = await db.rpc('share_claim_dispatch', { p_lease: lease, p_limit: 25 });
  if (error) throw new Error('share_dispatch_storage_unavailable');
  const imports = new SupabaseUserImportRepository(db), sources = createContentSourceService(db);
  let dispatched = 0;
  for (const row of (data ?? []) as { user_id: string; capture_id: string; import_id: string }[]) {
    try {
      const imported = await imports.findById(row.import_id);
      if (!imported || imported.userId !== row.user_id || imported.hiddenAt || !imported.contentSourceId) continue;
      const source = await sources.getById(imported.contentSourceId);
      if (!source) continue;
      // A late importer must be fanned out after the in-flight owner finishes.
      // Acknowledging this receipt now can miss the owner's final importer snapshot.
      if (source.processingStatus === 'PROCESSING') continue;
      const queue = getContentSourceProcessingQueue();
      // Queue pressure defers durable receipts, never drops them or marks extraction successful.
      if (source.processingStatus === 'RECEIVED' || source.processingStatus === 'QUEUED') {
        const counts = await queue.getJobCounts('wait', 'delayed');
        if ((counts.wait ?? 0) + (counts.delayed ?? 0) >= 1000) continue;
        if (source.processingStatus === 'RECEIVED') {
          const handedOff = await sources.requestProcessing({ contentSource: source, userImportId: imported.id });
          if (handedOff.enqueueFailed) throw new Error('share_dispatch_enqueue_deferred');
        } else {
          const existing = await queue.getJob(contentSourceProcessingJobId(source.id));
          if (!existing || ['failed','completed'].includes(await existing.getState())) {
            await enqueueContentSourceProcessing({ contentSourceId: source.id, userImportId: imported.id });
          }
        }
      } else if (source.processingStatus === 'READY' || source.processingStatus === 'FAILED') {
        await createUserImportBagSync(db).applyIfResolved(imported);
        await syncImportPlaces(new SupabasePlaceRepository(db), imported);
      }
      if (source.processingStatus === 'RECEIVED' || source.processingStatus === 'QUEUED') {
        const current = await sources.getById(source.id);
        if (current?.processingStatus === 'PROCESSING') continue;
        if (current?.processingStatus === 'READY' || current?.processingStatus === 'FAILED') {
          await createUserImportBagSync(db).applyIfResolved(imported);
          await syncImportPlaces(new SupabasePlaceRepository(db), imported);
        }
      }
      const updated = await db.from('share_acceptance_receipts').update({ dispatch_pending: false, dispatch_lease: null,
        dispatch_after: new Date(Date.now() + 60_000).toISOString() }).eq('user_id', row.user_id)
        .eq('capture_id', row.capture_id).eq('dispatch_lease', lease);
      if (updated.error) throw new Error('share_dispatch_ack_failed');
      dispatched++;
    } catch {
      logger.warn({ event: 'share.dispatch.deferred', captureId: row.capture_id }, 'share.dispatch.deferred');
    }
  }
  return dispatched;
}
export function startShareRecovery(db: SupabaseClient, stopped: () => boolean): () => void {
  if (getEnv('SHARE_ACCEPT_ENABLED') !== 'true') return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped()) return;
    if (getEnv('SHARE_ACCEPT_ENABLED') === 'true') {
      try { await dispatchAcceptedShares(db); } catch { logger.warn({ event: 'share.dispatch.unavailable' }, 'share.dispatch.unavailable'); }
    }
    if (!stopped()) { timer = setTimeout(() => void tick(), 30_000); timer.unref(); }
  };
  void tick();
  return () => { if (timer) clearTimeout(timer); };
}
