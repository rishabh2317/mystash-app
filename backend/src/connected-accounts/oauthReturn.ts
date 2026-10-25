import type { OAuthSurface } from './domain/types';
import { getEnv } from '../env';

export const YOUTUBE_OAUTH_CALLBACK_PATH = '/connected-accounts/youtube/oauth/callback';

const APP_CALLBACK_PATH = '/connected-accounts/callback';
const NATIVE_RETURN_URL = `mystash://connected-accounts/callback`;

const SAFE_OAUTH_ERRORS = new Set([
  'access_denied',
  'invalid_state',
  'missing_code',
  'exchange_failed',
  'disabled',
  'server_error',
  'temporarily_unavailable',
]);

/** Google redirect_uri must be the backend callback, never the app scheme. */
export function assertYouTubeOAuthRedirectUri(redirectUri: string): void {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new Error('YOUTUBE_OAUTH_REDIRECT_URI must be an absolute URL');
  }
  const localHttp =
    url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error(
      'YOUTUBE_OAUTH_REDIRECT_URI must be https, or http://localhost for local simulator/web',
    );
  }
  if (url.pathname !== YOUTUBE_OAUTH_CALLBACK_PATH) {
    throw new Error(`YOUTUBE_OAUTH_REDIRECT_URI path must be ${YOUTUBE_OAUTH_CALLBACK_PATH}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('YOUTUBE_OAUTH_REDIRECT_URI must not include credentials, query, or hash');
  }
}

export function oauthReturnUrl(surface: OAuthSurface): string {
  if (surface === 'web') {
    const raw = getEnv('CONNECTED_ACCOUNTS_WEB_RETURN_ORIGIN')?.trim();
    if (!raw) {
      throw new Error('CONNECTED_ACCOUNTS_WEB_RETURN_ORIGIN is not configured');
    }
    let origin: URL;
    try {
      origin = new URL(raw);
    } catch {
      throw new Error('CONNECTED_ACCOUNTS_WEB_RETURN_ORIGIN must be an absolute http(s) origin');
    }
    const localHttp =
      origin.protocol === 'http:' &&
      (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1');
    if (origin.protocol !== 'https:' && !localHttp) {
      throw new Error('CONNECTED_ACCOUNTS_WEB_RETURN_ORIGIN must be https, or http://localhost');
    }
    return `${origin.origin}${APP_CALLBACK_PATH}`;
  }
  const raw = getEnv('CONNECTED_ACCOUNTS_NATIVE_RETURN_URL')?.trim() || NATIVE_RETURN_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('CONNECTED_ACCOUNTS_NATIVE_RETURN_URL is invalid');
  }
  if (url.protocol !== 'mystash:') {
    throw new Error('CONNECTED_ACCOUNTS_NATIVE_RETURN_URL must use the mystash scheme');
  }
  if (url.hostname !== 'connected-accounts' || url.pathname !== '/callback') {
    throw new Error('CONNECTED_ACCOUNTS_NATIVE_RETURN_URL must be mystash://connected-accounts/callback');
  }
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export function appendOAuthReturnQuery(base: string, query: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function safeOAuthErrorCode(raw: string): string {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (SAFE_OAUTH_ERRORS.has(normalized)) return normalized;
  if (/invalid or reused oauth state/i.test(raw)) return 'invalid_state';
  if (/disabled/i.test(raw)) return 'disabled';
  return 'exchange_failed';
}
