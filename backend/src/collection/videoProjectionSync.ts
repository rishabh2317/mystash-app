import type { SupabaseClient } from '@supabase/supabase-js';
import type { Collection } from './domain/types';

function isPubliclyReadableCollection(collection: Collection): boolean {
  return (
    collection.status === 'published' &&
    collection.visibility === 'public' &&
    collection.moderationState === 'clear' &&
    !collection.deletedAt
  );
}

/**
 * Keep Home Feed projection aligned with Collection visibility lifecycle.
 * When a Collection stops being publicly readable, remove its feed video.
 */
export async function pruneVideoProjectionIfNotPublic(
  admin: SupabaseClient,
  collection: Collection,
): Promise<void> {
  if (isPubliclyReadableCollection(collection)) return;
  const { error } = await admin.from('videos').delete().eq('collection_id', collection.id);
  if (error) throw new Error(error.message);
}

