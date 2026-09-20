import type { SupabaseClient } from '@supabase/supabase-js';
import { DiscoveredProductService } from './DiscoveredProductService';
import { SupabaseDiscoveredProductRepository } from './SupabaseDiscoveredProductRepository';

export function createDiscoveredProductService(admin: SupabaseClient): DiscoveredProductService {
  return new DiscoveredProductService(new SupabaseDiscoveredProductRepository(admin));
}

export { DiscoveredProductService } from './DiscoveredProductService';
export { InMemoryDiscoveredProductRepository } from './InMemoryDiscoveredProductRepository';
