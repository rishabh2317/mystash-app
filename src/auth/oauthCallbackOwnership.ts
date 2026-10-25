/**
 * Google OAuth in a Custom Tab and Expo Router both receive the same
 * `mystash://auth/callback` (or Expo) URL. The in-app `openAuthSessionAsync`
 * caller owns the warm-start exchange; the router must not also navigate there.
 */

export function isSupabaseAuthCallbackPath(path: string): boolean {
  let value = path;
  try {
    value = decodeURIComponent(path);
  } catch {
    value = path;
  }
  if (/(?:^|[/:])connected-accounts\/callback(?:[/?#]|$)/.test(value)) return false;
  return /(?:^|[/:])auth\/callback(?:[/?#]|$)/.test(value);
}

let inAppAuthSessions = 0;

export function beginInAppAuthSession(): void {
  inAppAuthSessions += 1;
}

export function endInAppAuthSession(): void {
  inAppAuthSessions = Math.max(0, inAppAuthSessions - 1);
}

export function hasInAppAuthSession(): boolean {
  return inAppAuthSessions > 0;
}

export function resetInAppAuthSessionForTests(): void {
  inAppAuthSessions = 0;
}

/**
 * Warm start + in-app browser session: skip Expo Router so the auth-session
 * listener is the only owner. Cold start has no listener, so keep the route.
 */
export function rewriteNativeAuthCallbackPath(
  path: string,
  initial: boolean,
): string | null | undefined {
  if (!isSupabaseAuthCallbackPath(path)) return undefined;
  if (!initial && hasInAppAuthSession()) return null;
  return undefined;
}

export type AuthSessionBrowserResult = {
  type: string;
  url?: string | null;
};

export type InterpretedAuthSession =
  | { kind: 'cancel' }
  | { kind: 'success'; url: string }
  | { kind: 'error'; message: string };

export function interpretAuthSessionResult(
  result: AuthSessionBrowserResult,
): InterpretedAuthSession {
  if (result.type === 'cancel' || result.type === 'dismiss') return { kind: 'cancel' };
  if (result.type === 'success' && result.url) return { kind: 'success', url: result.url };
  return { kind: 'error', message: 'Google sign in did not return a valid callback URL.' };
}
