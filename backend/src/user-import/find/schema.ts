import type { SupabaseClient } from '@supabase/supabase-js';

/** Read-only preflight: this release requires the matching, separately approved migration. */
export async function assertFindSchema(db: SupabaseClient): Promise<void> {
  const { data, error } = await db.rpc('find_schema_version').abortSignal(AbortSignal.timeout(5000));
  if (error || data !== 4) throw new Error('Find schema incompatible; matching migration required before this release');
}
