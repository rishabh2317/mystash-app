/**
 * Session presence is not email verification. Privileged User/Collection/Cart
 * writes require a confirmed address (or a trusted OAuth identity).
 */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';
export const UNVERIFIED_EMAIL_MESSAGE = 'Confirm your email to continue.';

export class UnverifiedEmailError extends Error {
  readonly statusCode = 403;
  readonly code = EMAIL_NOT_VERIFIED;
  constructor() {
    super(UNVERIFIED_EMAIL_MESSAGE);
    this.name = 'UnverifiedEmailError';
  }
}

export function assertEmailVerified(user: AuthEmailUser | null | undefined): void {
  if (!isAuthEmailVerified(user)) {
    throw new UnverifiedEmailError();
  }
}

export type AuthEmailUser = {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: Array<{
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  }> | null;
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
