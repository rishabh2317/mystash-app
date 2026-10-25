/** Keep in sync with backend/src/auth/emailVerification.ts */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

export type AuthEmailUser = {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: {
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  }[] | null;
};

export function isAuthEmailVerified(user: AuthEmailUser | null | undefined): boolean {
  if (!user) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;
  for (const identity of user.identities ?? []) {
    if (!identity.provider || identity.provider === 'email') continue;
    const data = identity.identity_data ?? {};
    if (data.email_verified === true || data.email_verified === 'true') return true;
  }
  return false;
}
