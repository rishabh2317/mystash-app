import type { SupabaseClient } from '@supabase/supabase-js';
import { createContentSourceService } from '../content-source/factory';
import { createUserImportBagSync } from '../content-source/processing/userImportBagSync';
import { SupabaseUserImportRepository } from './SupabaseUserImportRepository';
import { UserImportService } from './UserImportService';
import type { UserImportBagSyncPort, UserImportContentSourcePort } from './ports';

export function createUserImportContentSourcePort(
  admin: SupabaseClient,
): UserImportContentSourcePort {
  const contentSource = createContentSourceService(admin);
  return {
    getOrCreate: (normalizedUrl) => contentSource.getOrCreate(normalizedUrl),
    getById: (id) => contentSource.getById(id),
    requestProcessing: (params) => contentSource.requestProcessing(params),
  };
}

export function createUserImportService(
  admin: SupabaseClient,
  contentSource?: UserImportContentSourcePort,
  bagSync?: UserImportBagSyncPort | null,
): UserImportService {
  return new UserImportService(
    new SupabaseUserImportRepository(admin),
    contentSource ?? createUserImportContentSourcePort(admin),
    bagSync === undefined ? createUserImportBagSync(admin) : bagSync,
  );
}

export { InMemoryUserImportRepository } from './InMemoryUserImportRepository';
export { UserImportService, UserImportServiceError } from './UserImportService';
export type { UserImportBagSyncPort, UserImportContentSourcePort } from './ports';
