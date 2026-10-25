/**
 * Trusted email-verified state from a Supabase Auth user object.
 * A session does not imply the address is confirmed.
 */
export type AuthEmailIdentity = {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: {
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  }[] | null;
};

function identityEmailVerified(identity: {
  provider?: string | null;
  identity_data?: Record<string, unknown> | null;
}): boolean {
  const data = identity.identity_data ?? {};
  return data.email_verified === true || data.email_verified === 'true';
}

export function isAuthEmailVerified(user: AuthEmailIdentity | null | undefined): boolean {
  if (!user) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;
  for (const identity of user.identities ?? []) {
    if (!identity.provider || identity.provider === 'email') continue;
    if (identityEmailVerified(identity)) return true;
  }
  return false;
}
