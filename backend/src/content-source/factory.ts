import type { SupabaseClient } from '@supabase/supabase-js';
import { ContentSourceService } from './ContentSourceService';
import { enqueueContentSourceProcessing } from './jobs/contentSourceQueue';
import { SupabaseContentSourceRepository } from './SupabaseContentSourceRepository';
import type { ContentProcessingQueuePort } from './ports';

export function createContentProcessingQueuePort(): ContentProcessingQueuePort {
  return { enqueue: (data) => enqueueContentSourceProcessing(data) };
}

export function createContentSourceService(
  admin: SupabaseClient,
  queue: ContentProcessingQueuePort = createContentProcessingQueuePort(),
): ContentSourceService {
  return new ContentSourceService(new SupabaseContentSourceRepository(admin), queue);
}

export { ContentSourceService, ContentSourceServiceError } from './ContentSourceService';
export { InMemoryContentSourceRepository } from './InMemoryContentSourceRepository';
export {
  enqueueContentSourceProcessing,
} from './jobs/contentSourceQueue';
export { startContentSourceProcessingWorker } from './jobs/contentSourceWorker';
export type { ContentProcessingQueuePort } from './ports';
