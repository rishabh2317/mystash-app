/**
 * Client routing only. A recovery JWT is a full Supabase session; write APIs
 * still authorize the account owner. This is not a security boundary.
 */
export function shouldRedirectToPasswordReset(input: {
  loading: boolean;
  hasSession: boolean;
  passwordRecoveryPending: boolean;
  pathname: string | null | undefined;
}): boolean {
  if (input.loading || !input.hasSession || !input.passwordRecoveryPending) return false;
  const path = input.pathname ?? '';
  if (path.includes('reset-password') || path.includes('auth/callback')) return false;
  return true;
}
