import type { SupabaseClient } from '@supabase/supabase-js';
import { createCartService } from '../../cart/factory';
import { createDiscoveredProductService } from '../../discovered/factory';
import { createProductIntelligence } from '../../product-intelligence/factory';
import type { UserImportBagSyncPort } from '../../user-import/ports';
import { SupabaseUserImportRepository } from '../../user-import/SupabaseUserImportRepository';
import { SupabaseContentSourceRepository } from '../SupabaseContentSourceRepository';
import { ContentSourceResolutionService } from './ContentSourceResolutionService';

/**
 * Late-share fan-out: when a user imports a source that is already resolved,
 * requestProcessing is suppressed, so membership is applied here.
 */
export function createUserImportBagSync(admin: SupabaseClient): UserImportBagSyncPort {
  const sources = new SupabaseContentSourceRepository(admin);
  const userImports = new SupabaseUserImportRepository(admin);
  const pi = createProductIntelligence(admin, 'content-source', null, 'content-source');
  const resolution = pi
    ? new ContentSourceResolutionService(
        sources,
        createDiscoveredProductService(admin),
        {
          resolveForUserImport: (drafts) => pi.resolver.resolveForUserImport(drafts),
          resolveForUserImportFast: (drafts) => pi.resolver.resolveForUserImportFast(drafts),
        },
        userImports,
        createCartService(admin),
      )
    : null;

  return {
    async applyIfResolved(row) {
      if (!resolution) return;
      await resolution.fanOutUser(row);
    },
  };
}
