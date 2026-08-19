import type { SupabaseClient } from '@supabase/supabase-js';
import { CollectionService } from './CollectionService';
import { SupabaseCollectionRepository } from './SupabaseCollectionRepository';
import { createUserService } from '../user/factory';
import { createCollectionTagRemapPort } from './catalogRemap';

export function createCollectionService(admin: SupabaseClient): CollectionService {
  const users = createUserService(admin);
  return new CollectionService(new SupabaseCollectionRepository(admin), users);
}

export function createCollectionTagRemap(admin: SupabaseClient) {
  return createCollectionTagRemapPort(createCollectionService(admin));
}

export { CollectionService, CollectionServiceError } from './CollectionService';
export type { CollectionRepository } from './CollectionRepository';
export { createCollectionTagRemapPort } from './catalogRemap';
