import { supabase } from '@/src/services/supabase';

import type { AuthCallbackDeps } from './authCallback';

/** Single Auth client + AsyncStorage PKCE verifier for every callback owner. */
export function supabaseAuthCallbackDeps(): AuthCallbackDeps {
  return {
    getSession: async () => {
      const { data } = await supabase.auth.getSession();
      return { session: data.session };
    },
    exchangeCodeForSession: async (code) => {
      const exchanged = await supabase.auth.exchangeCodeForSession(code);
      return { error: exchanged.error, session: exchanged.data.session };
    },
    verifyOtp: async (input) => {
      const verified = await supabase.auth.verifyOtp({
        token_hash: input.token_hash,
        type: input.type as
          | 'signup'
          | 'recovery'
          | 'email'
          | 'magiclink'
          | 'invite'
          | 'email_change',
      });
      return { error: verified.error, session: verified.data.session };
    },
  };
}
