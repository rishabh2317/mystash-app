import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCatalogRepository } from '../product-intelligence/catalog/SupabaseCatalogRepository';
import { CatalogService } from './CatalogService';
import { noopCollectionTagRemap, type CollectionTagRemapPort } from './ports';

export function createCatalogService(
  admin: SupabaseClient,
  tagRemap: CollectionTagRemapPort = noopCollectionTagRemap,
): CatalogService {
  return new CatalogService(new SupabaseCatalogRepository(admin), tagRemap);
}

export { CatalogService, CatalogServiceError } from './CatalogService';
export { InMemoryCatalogRepository } from './InMemoryCatalogRepository';
export type { CollectionTagRemapPort } from './ports';
export { noopCollectionTagRemap, composeCollectionTagRemaps } from './ports';
