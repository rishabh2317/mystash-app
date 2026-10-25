import type { SupabaseClient } from '@supabase/supabase-js';
import { InMemoryNotificationRepository } from './InMemoryNotificationRepository';
import type { NotificationRepository } from './NotificationRepository';
import { NotificationService } from './NotificationService';
import type { PushRepository } from './PushRepository';
import { SupabaseNotificationRepository } from './SupabaseNotificationRepository';
import { SupabasePushRepository } from './SupabasePushRepository';

export function createNotificationRepository(admin: SupabaseClient): NotificationRepository {
  return new SupabaseNotificationRepository(admin);
}

export function createNotificationService(admin: SupabaseClient): NotificationService {
  return new NotificationService(createNotificationRepository(admin));
}

export function createPushRepository(admin: SupabaseClient): PushRepository {
  return new SupabasePushRepository(admin);
}

export function createInMemoryNotificationService(
  repo: NotificationRepository = new InMemoryNotificationRepository(),
): NotificationService {
  return new NotificationService(repo);
}

export { NotificationService, NotificationServiceError } from './NotificationService';
export type { NotificationRepository } from './NotificationRepository';
