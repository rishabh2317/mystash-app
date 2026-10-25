import { getEnv } from '../env';
import type { ConnectedAccountProvider } from './domain/types';

function truthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isConnectedAccountProviderEnabled(provider: ConnectedAccountProvider): boolean {
  if (provider === 'youtube') {
    return truthy(getEnv('CONNECTED_ACCOUNTS_YOUTUBE_ENABLED'));
  }
  return truthy(getEnv('CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED'));
}

export function getConnectedAccountsEncryptionConfigured(): boolean {
  return Boolean(getEnv('CONNECTED_ACCOUNTS_ENCRYPTION_KEY')?.trim());
}

export function getOAuthStateSecret(): string {
  return (
    getEnv('CONNECTED_ACCOUNTS_OAUTH_STATE_SECRET')?.trim() ||
    getEnv('CONNECTED_ACCOUNTS_ENCRYPTION_KEY')?.trim() ||
    ''
  );
}

export type YouTubeOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getYouTubeOAuthEnv(): YouTubeOAuthEnv | null {
  const clientId = getEnv('YOUTUBE_OAUTH_CLIENT_ID')?.trim();
  const clientSecret = getEnv('YOUTUBE_OAUTH_CLIENT_SECRET')?.trim();
  const redirectUri = getEnv('YOUTUBE_OAUTH_REDIRECT_URI')?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export type InstagramOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getInstagramOAuthEnv(): InstagramOAuthEnv | null {
  const clientId = getEnv('INSTAGRAM_OAUTH_CLIENT_ID')?.trim();
  const clientSecret = getEnv('INSTAGRAM_OAUTH_CLIENT_SECRET')?.trim();
  const redirectUri = getEnv('INSTAGRAM_OAUTH_REDIRECT_URI')?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}
