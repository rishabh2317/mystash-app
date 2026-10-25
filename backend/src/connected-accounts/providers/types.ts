import type { ConnectedAccountProvider, OAuthTokenBundle } from '../domain/types';

export type OAuthStartResult = {
  authorizeUrl: string;
};

export type HealthProbeResult = {
  ok: boolean;
  platformAccountId: string;
  displayName: string | null;
  username: string | null;
  error: string | null;
};

export interface ConnectedAccountOAuthProvider {
  readonly provider: ConnectedAccountProvider;
  buildAuthorizeUrl(params: { state: string }): OAuthStartResult;
  exchangeCode(params: { code: string }): Promise<OAuthTokenBundle>;
  healthCheck(params: { accessToken: string }): Promise<HealthProbeResult>;
  /** Best-effort provider revoke; may be a no-op. */
  revoke?(params: { accessToken: string }): Promise<void>;
  /** Server-side refresh. Must not log tokens. */
  refreshAccessToken?(params: { refreshToken: string }): Promise<{
    accessToken: string;
    expiresAt: string | null;
    refreshToken: string | null;
  }>;
}
