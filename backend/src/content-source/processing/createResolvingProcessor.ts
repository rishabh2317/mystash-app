import type { SupabaseClient } from '@supabase/supabase-js';
import { createCartService } from '../../cart/factory';
import { createDiscoveredProductService } from '../../discovered/factory';
import { createProductIntelligence } from '../../product-intelligence/factory';
import { SupabaseUserImportRepository } from '../../user-import/SupabaseUserImportRepository';
import { SupabaseContentSourceRepository } from '../SupabaseContentSourceRepository';
import { ContentSourceProcessor } from './ContentSourceProcessor';
import { ContentSourceResolutionService } from './ContentSourceResolutionService';
import { createVideoExtractionAdapter } from './videoAdapter';
import { createWebEnrichmentAdapter } from './webAdapter';

/**
 * Worker wiring for Phase 4: extraction (Phase 3) plus non-promoting resolve + Bag fan-out.
 * Kept out of createProcessor.ts so Phase 3 source-isolation tests stay valid.
 */
export function createResolvingContentSourceProcessor(
  admin: SupabaseClient,
): ContentSourceProcessor {
  const sources = new SupabaseContentSourceRepository(admin);
  const userImports = new SupabaseUserImportRepository(admin);
  const pi = createProductIntelligence(admin, 'content-source', null, 'content-source');
  const resolution = pi
    ? new ContentSourceResolutionService(
        sources,
        createDiscoveredProductService(admin),
        { resolveForUserImport: (drafts) => pi.resolver.resolveForUserImport(drafts) },
        userImports,
        createCartService(admin),
      )
    : null;

  return new ContentSourceProcessor({
    sources,
    userImports,
    video: createVideoExtractionAdapter(admin),
    web: createWebEnrichmentAdapter(admin),
    resolution,
  });
}
