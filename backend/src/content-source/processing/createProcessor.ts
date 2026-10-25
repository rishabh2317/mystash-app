import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseContentSourceRepository } from '../SupabaseContentSourceRepository';
import { SupabaseUserImportRepository } from '../../user-import/SupabaseUserImportRepository';
import { ContentSourceProcessor } from './ContentSourceProcessor';
import { createVideoExtractionAdapter } from './videoAdapter';
import { createWebEnrichmentAdapter } from './webAdapter';
import { SupabasePlaceRepository } from '../../place/SupabasePlaceRepository';

export function createContentSourceProcessor(admin: SupabaseClient): ContentSourceProcessor {
  return new ContentSourceProcessor({
    sources: new SupabaseContentSourceRepository(admin),
    userImports: new SupabaseUserImportRepository(admin),
    video: createVideoExtractionAdapter(admin),
    web: createWebEnrichmentAdapter(admin),
    places: new SupabasePlaceRepository(admin),
  });
}
