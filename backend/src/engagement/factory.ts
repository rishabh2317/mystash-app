import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementService } from './EngagementService';
import { SupabaseEngagementRepository } from './SupabaseEngagementRepository';
import type { CollectionCounterDenormPort, UserCounterDenormPort } from './ports';
import { createUserService } from '../user/factory';

export function createCollectionCounterDenorm(
  admin: SupabaseClient,
): CollectionCounterDenormPort {
  return {
    async applyCollectionCounters(collectionId, counters) {
      const row: Record<string, unknown> = {
        counters_updated_at: new Date().toISOString(),
      };
      if (counters.viewsCount !== undefined) row.views_count = counters.viewsCount;
      if (counters.savesCount !== undefined) row.saves_count = counters.savesCount;
      if (counters.sharesCount !== undefined) row.shares_count = counters.sharesCount;
      if (counters.productClicksCount !== undefined) {
        row.product_clicks_count = counters.productClicksCount;
      }
      if (counters.purchasesCount !== undefined) row.purchases_count = counters.purchasesCount;
      await admin.from('collections').update(row).eq('id', collectionId);
    },
  };
}

export function createUserCounterDenorm(admin: SupabaseClient): UserCounterDenormPort {
  const users = createUserService(admin);
  return {
    async applyUserCounters(userId, counters) {
      await users.applyCounters(userId, counters);
    },
  };
}

export function createEngagementService(
  admin: SupabaseClient,
  opts?: {
    collections?: CollectionCounterDenormPort;
    users?: UserCounterDenormPort;
  },
): EngagementService {
  return new EngagementService(
    new SupabaseEngagementRepository(admin),
    opts?.collections ?? createCollectionCounterDenorm(admin),
    opts?.users ?? createUserCounterDenorm(admin),
  );
}

export { EngagementService, EngagementServiceError } from './EngagementService';
export { InMemoryEngagementRepository } from './InMemoryEngagementRepository';
export type { CollectionCounterDenormPort, UserCounterDenormPort } from './ports';
export { noopCollectionCounterDenorm, noopUserCounterDenorm } from './ports';
