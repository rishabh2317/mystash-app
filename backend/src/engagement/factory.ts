import type { SupabaseClient } from '@supabase/supabase-js';
import type { EngagementService } from './EngagementService';
import { AtomicEngagementService } from './AtomicEngagementService';
import type { CollectionCounterDenormPort, UserCounterDenormPort } from './ports';
import { createUserService } from '../user/factory';
import { getNotificationEmitter } from '../notifications/producers';

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
      const { error } = await admin.from('collections').update(row).eq('id', collectionId);
      if (error) throw new Error(error.message);
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

export function createEngagementService(admin: SupabaseClient): EngagementService {
  return new AtomicEngagementService(admin, getNotificationEmitter());
}

export { EngagementService, EngagementServiceError } from './EngagementService';
export { InMemoryEngagementRepository } from './InMemoryEngagementRepository';
export type { CollectionCounterDenormPort, UserCounterDenormPort } from './ports';
export { noopCollectionCounterDenorm, noopUserCounterDenorm } from './ports';
