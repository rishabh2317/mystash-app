import type {
  ConnectedAccountProvider,
  ConnectedAccountView,
  ConnectedAccountsSnapshot,
} from '@/src/types/connectedAccounts';

export type {
  ConnectedAccountProvider,
  ConnectedAccountView,
  ConnectedAccountsSnapshot,
} from '@/src/types/connectedAccounts';

export function pickProviderAccount(
  snapshot: ConnectedAccountsSnapshot | null,
  provider: ConnectedAccountProvider,
): ConnectedAccountView | null {
  if (!snapshot) return null;
  const rows = snapshot.accounts.filter(
    (a) => a.provider === provider && a.status !== 'disconnected',
  );
  return rows[0] ?? null;
}

export function shouldShowConnectedProvider(
  linkingEnabled: boolean,
  account: ConnectedAccountView | null,
): boolean {
  return linkingEnabled || Boolean(account);
}

export function providerStatusLabel(
  account: ConnectedAccountView | null,
  linkingEnabled: boolean,
): string {
  if (!linkingEnabled && !account) return 'Not connected';
  if (!account) return 'Not connected';
  if (account.status === 'needs_reauth') return 'Needs re-auth';
  if (account.status === 'active') {
    return account.username || account.displayName || 'Connected';
  }
  if (account.status === 'revoked') return 'Revoked';
  return 'Not connected';
}

export type ConnectedAccountOAuthSurface = 'native' | 'web';

export function connectedAccountOAuthSurface(platformOs: string): ConnectedAccountOAuthSurface {
  return platformOs === 'web' ? 'web' : 'native';
}

/** Result of the app return hop. The Google code is not on this URL. */
export function readConnectedAccountOAuthReturn(
  params: Record<string, string | undefined>,
): { ok: true } | { ok: false; error: string } {
  if (params.status === 'connected') return { ok: true };
  if (params.error === 'access_denied') return { ok: false, error: 'Google sign-in was canceled.' };
  if (params.error === 'invalid_state') {
    return { ok: false, error: 'This connect attempt expired. Try again.' };
  }
  if (params.error) return { ok: false, error: 'YouTube could not be linked. Try again.' };
  return { ok: false, error: 'YouTube connect did not finish.' };
}

/**
 * True for the app return hop (`mystash://connected-accounts/callback` and the
 * path Expo extracts from it). Does not match the Supabase `auth/callback`.
 */
export function isConnectedAccountOAuthCallback(path: string): boolean {
  let value = path;
  try {
    value = decodeURIComponent(path);
  } catch {
    value = path;
  }
  return /(?:^|[/:])connected-accounts\/callback(?:[/?#]|$)/.test(value);
}

/**
 * `openAuthSessionAsync` does not take exclusive ownership of a custom-scheme
 * redirect. Expo Router receives the same URL and will navigate it.
 *
 * While the app is already open, return null so the router skips the URL and
 * the auth-session listener can finish. On a cold start there is no session,
 * so open Settings, which reloads connected accounts.
 *
 * Returns undefined when the URL is not this callback, so other deep links
 * are left unchanged.
 */
export function rewriteNativeOAuthCallbackPath(
  path: string,
  initial: boolean,
): string | null | undefined {
  if (!isConnectedAccountOAuthCallback(path)) return undefined;
  return initial ? '/settings' : null;
}
