import { supabase } from './supabase';
import { createFindClient } from './findClient';
/** Data layer for Phase 3; no new screen, navigation or background polling starts here. */
export const findApi = createFindClient({
  baseURL: () => process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL,
  fetch: (...args) => fetch(...args),
  session: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session ? { userId: data.session.user.id, accessToken: data.session.access_token } : null;
  },
});
