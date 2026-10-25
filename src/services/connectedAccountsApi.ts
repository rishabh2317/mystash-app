import { supabase } from '@/src/services/supabase';
import type {
  ConnectedAccountProvider,
  ConnectedAccountView,
  ConnectedAccountsSnapshot,
} from '@/src/types/connectedAccounts';
import {
  connectedAccountOAuthSurface,
  readConnectedAccountOAuthReturn,
} from '@/src/ui/connectedAccounts';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export type {
  ConnectedAccountProvider,
  ConnectedAccountStatus,
  ConnectedAccountView,
  ConnectedAccountsSnapshot,
} from '@/src/types/connectedAccounts';

export class ConnectedAccountsApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ConnectedAccountsApiError';
  }
}

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new ConnectedAccountsApiError('Mystash service is not configured.', 500);
  }
  return base;
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ConnectedAccountsApiError('Not authenticated', 401);
  }
  return token;
}

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ConnectedAccountsApiError(
      body.error ?? `Connected accounts API failed (${res.status})`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

export async function listConnectedAccounts(): Promise<ConnectedAccountsSnapshot> {
  return authedJson<ConnectedAccountsSnapshot>('/users/me/connected-accounts');
}

export async function startConnectedAccountOAuth(
  provider: ConnectedAccountProvider,
  surface: 'native' | 'web' = connectedAccountOAuthSurface(Platform.OS),
): Promise<{ authorizeUrl: string; state: string }> {
  return authedJson(`/users/me/connected-accounts/${provider}/oauth/start`, {
    method: 'POST',
    body: JSON.stringify({ surface }),
  });
}

export async function completeConnectedAccountOAuth(
  provider: ConnectedAccountProvider,
  input: { code: string; state: string },
): Promise<ConnectedAccountView> {
  const body = await authedJson<{ account: ConnectedAccountView }>(
    `/users/me/connected-accounts/${provider}/oauth/complete`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return body.account;
}

export async function disconnectConnectedAccount(id: string): Promise<ConnectedAccountView> {
  const body = await authedJson<{ account: ConnectedAccountView }>(
    `/users/me/connected-accounts/${id}/disconnect`,
    { method: 'POST' },
  );
  return body.account;
}

export async function reauthConnectedAccount(
  id: string,
  surface: 'native' | 'web' = connectedAccountOAuthSurface(Platform.OS),
): Promise<{ authorizeUrl: string; state: string }> {
  return authedJson(`/users/me/connected-accounts/${id}/reauth`, {
    method: 'POST',
    body: JSON.stringify({ surface }),
  });
}

export async function healthCheckConnectedAccount(id: string): Promise<ConnectedAccountView> {
  const body = await authedJson<{ account: ConnectedAccountView }>(
    `/users/me/connected-accounts/${id}/health`,
    { method: 'POST' },
  );
  return body.account;
}

function getParamsFromUrl(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const query = url.includes('?') ? url.split('?')[1]!.split('#')[0] : '';
  const hash = url.includes('#') ? url.split('#')[1]! : '';
  for (const part of [query, hash]) {
    if (!part) continue;
    new URLSearchParams(part).forEach((value, key) => {
      params[key] = value;
    });
  }
  return params;
}

/**
 * Opens the provider authorize URL in the system browser session.
 * Google redirects to the backend, which exchanges the code and then redirects
 * here. This return URL is not the Google redirect_uri.
 */
async function finishAuthSession(authorizeUrl: string): Promise<void> {
  const redirectUrl =
    Platform.OS === 'web'
      ? Linking.createURL('connected-accounts/callback')
      : 'mystash://connected-accounts/callback';
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUrl);
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    return;
  }
  const outcome = readConnectedAccountOAuthReturn(getParamsFromUrl(result.url));
  if (!outcome.ok) {
    throw new ConnectedAccountsApiError(outcome.error, 400);
  }
}

export async function connectProviderWithBrowser(
  provider: ConnectedAccountProvider,
): Promise<ConnectedAccountView | null> {
  const started = await startConnectedAccountOAuth(provider);
  await finishAuthSession(started.authorizeUrl);
  return null;
}

export async function reauthProviderWithBrowser(accountId: string): Promise<void> {
  const started = await reauthConnectedAccount(accountId);
  await finishAuthSession(started.authorizeUrl);
}
