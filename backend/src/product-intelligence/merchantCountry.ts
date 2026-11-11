import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseUserRepository } from '../user/SupabaseUserRepository';
import { resolveCountryCode } from '../merchant-pricing/country';

export async function ingestMerchantCountry(admin: SupabaseClient, userId?: string | null): Promise<string> {
  if (!userId) return resolveCountryCode({});
  try {
    const user = await new SupabaseUserRepository(admin).getById(userId);
    return resolveCountryCode({ profile: user?.country,deviceLocale:typeof user?.extensions?.shoppingLocale==='string'?user.extensions.shoppingLocale:user?.language });
  } catch { return resolveCountryCode({}); }
}
