import { randomUUID } from 'node:crypto';
import { readFindMemberships } from './membershipQuery';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserImportBagSync } from '../../content-source/processing/userImportBagSync';
import { SupabasePlaceRepository } from '../../place/SupabasePlaceRepository';
import { syncImportPlaces } from '../../place/syncImportPlaces';
import type { FindMembershipCounts } from './outcome';

export type StashSyncClaim = { id: string; user_id: string; content_source_id: string; stash_sync_revision: number };
export type StashSyncPort = {
  claim(lease: string): Promise<StashSyncClaim[]>;
  products(row: StashSyncClaim): Promise<void>;
  places(row: StashSyncClaim): Promise<void>;
  memberships(row: StashSyncClaim): Promise<Pick<FindMembershipCounts, 'missingProducts' | 'missingPlaces'>>;
  finish(row: StashSyncClaim, lease: string, success: boolean): Promise<boolean>;
};

/** No extraction, search or reasoning calls. Each failed delivery remains durably retryable. */
export async function reconcileStashSync(port: StashSyncPort): Promise<{ complete: number; deferred: number }> {
  const lease = randomUUID();
  const counts = { complete: 0, deferred: 0 };
  for (const row of await port.claim(lease)) {
    let success = false;
    try {
      const results = await Promise.allSettled([port.products(row), port.places(row)]);
      const membership = await port.memberships(row);
      success = results.every(r => r.status === 'fulfilled') && membership.missingProducts === 0 && membership.missingPlaces === 0;
    } catch { /* A storage failure cannot become a false successful delivery. */ }
    try {
      if (await port.finish(row, lease, success) && success) counts.complete++;
      else counts.deferred++;
    } catch { counts.deferred++; } // Lost acknowledgements recover after the claim lease expires.
  }
  return counts;
}

export function createStashSyncPort(db: SupabaseClient): StashSyncPort {
  const products = createUserImportBagSync(db), places = new SupabasePlaceRepository(db);
  return {
    async claim(lease) {
      const { data, error } = await db.rpc('find_claim_stash_sync', { p_lease: lease, p_limit: 25 }).abortSignal(AbortSignal.timeout(25_000));
      if (error) throw new Error('Stash synchronization unavailable');
      return data ?? [];
    },
    products: row => products.applyIfResolved({ id: row.id, userId: row.user_id, contentSourceId: row.content_source_id }),
    places: row => syncImportPlaces(places, { id: row.id, userId: row.user_id, contentSourceId: row.content_source_id }),
    async memberships(row) {
      const counts = (await readFindMemberships(db, row.user_id, [row.id])).get(row.id);
      if (!counts) throw new Error('Import no longer available');
      return counts;
    },
    async finish(row, lease, success) {
      const { data, error } = await db.rpc('find_finish_stash_sync', { p_import: row.id, p_lease: lease,
        p_revision: row.stash_sync_revision, p_success: success }).abortSignal(AbortSignal.timeout(25_000));
      if (error) throw new Error('Stash synchronization acknowledgement unavailable');
      return data === true;
    },
  };
}
