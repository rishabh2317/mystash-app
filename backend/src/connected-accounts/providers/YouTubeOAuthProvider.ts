import { getYouTubeOAuthEnv } from '../config';
import { assertYouTubeOAuthRedirectUri } from '../oauthReturn';
import type { OAuthTokenBundle } from '../domain/types';
import type {
  ConnectedAccountOAuthProvider,
  HealthProbeResult,
  OAuthStartResult,
} from './types';

const YT_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'].join(' ');

export class YouTubeOAuthProvider implements ConnectedAccountOAuthProvider {
  readonly provider = 'youtube' as const;

  buildAuthorizeUrl(params: { state: string }): OAuthStartResult {
    const env = getYouTubeOAuthEnv();
    if (!env) {
      throw new Error(
        'YouTube OAuth is not configured (YOUTUBE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI)',
      );
    }
    assertYouTubeOAuthRedirectUri(env.redirectUri);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.clientId);
    url.searchParams.set('redirect_uri', env.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YT_SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', params.state);
    return { authorizeUrl: url.toString() };
  }

  async exchangeCode(params: { code: string }): Promise<OAuthTokenBundle> {
    const env = getYouTubeOAuthEnv();
    if (!env) {
      throw new Error('YouTube OAuth is not configured');
    }
    assertYouTubeOAuthRedirectUri(env.redirectUri);
    const body = new URLSearchParams({
      code: params.code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description || tokenJson.error || 'YouTube token exchange failed');
    }
    const identity = await this.fetchChannel(tokenJson.access_token);
    const expiresAt =
      typeof tokenJson.expires_in === 'number'
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : null;
    return {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token ?? null,
      expiresAt,
      scopes: (tokenJson.scope ?? YT_SCOPES).split(/\s+/).filter(Boolean),
      platformAccountId: identity.platformAccountId,
      displayName: identity.displayName,
      username: identity.username,
    };
  }

  async healthCheck(params: { accessToken: string }): Promise<HealthProbeResult> {
    try {
      const identity = await this.fetchChannel(params.accessToken);
      return {
        ok: true,
        platformAccountId: identity.platformAccountId,
        displayName: identity.displayName,
        username: identity.username,
        error: null,
      };
    } catch (e) {
      return {
        ok: false,
        platformAccountId: '',
        displayName: null,
        username: null,
        error: e instanceof Error ? e.message : 'YouTube health check failed',
      };
    }
  }

  async refreshAccessToken(params: { refreshToken: string }): Promise<{
    accessToken: string;
    expiresAt: string | null;
    refreshToken: string | null;
  }> {
    const env = getYouTubeOAuthEnv();
    if (!env) throw new Error('YouTube OAuth is not configured');
    const body = new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: params.refreshToken,
      grant_type: 'refresh_token',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description || tokenJson.error || 'YouTube token refresh failed');
    }
    return {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token ?? null,
      expiresAt:
        typeof tokenJson.expires_in === 'number'
          ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
          : null,
    };
  }

  async revoke(params: { accessToken: string }): Promise<void> {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(params.accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      /* best-effort */
    }
  }

  private async fetchChannel(accessToken: string): Promise<{
    platformAccountId: string;
    displayName: string | null;
    username: string | null;
  }> {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json()) as {
      items?: Array<{
        id?: string;
        snippet?: { title?: string; customUrl?: string };
      }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || 'YouTube channels.list failed');
    }
    const item = json.items?.[0];
    if (!item?.id) {
      throw new Error('No YouTube channel found for this Google account');
    }
    return {
      platformAccountId: item.id,
      displayName: item.snippet?.title ?? null,
      username: item.snippet?.customUrl ?? null,
    };
  }
}
