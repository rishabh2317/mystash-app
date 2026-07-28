import { createClient } from '@supabase/supabase-js';
import { getEnv } from './env';

export function createSupabaseAdmin() {
  const url = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient(url, key);
}

export function createSupabaseUserClient(authHeader: string) {
  const url = getEnv('SUPABASE_URL');
  const anonKey = getEnv('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}
