/**
 * Phase 2 connected-account domain types.
 * @see docs/creator-ecosystem-phase-2-verify.md
 */

export type ConnectedAccountProvider = 'youtube' | 'instagram';

/** Where the backend sends the browser after the code exchange. Not a client-supplied URL. */
export type OAuthSurface = 'native' | 'web';

export type ConnectedAccountStatus =
  | 'active'
  | 'needs_reauth'
  | 'revoked'
  | 'disconnected';

/** Safe for API responses — never includes tokens. */
export type ConnectedAccountPublic = {
  id: string;
  userId: string;
  provider: ConnectedAccountProvider;
  platformAccountId: string;
  displayName: string | null;
  username: string | null;
  scopes: string[];
  status: ConnectedAccountStatus;
  lastHealthCheckAt: string | null;
  lastHealthError: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when provider feature flag allows connect/re-auth. */
  linkingEnabled: boolean;
};

export type ConnectedAccountSecretRecord = {
  connectedAccountId: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: string | null;
  encryptionKeyId: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertConnectedAccountInput = {
  userId: string;
  provider: ConnectedAccountProvider;
  platformAccountId: string;
  displayName: string | null;
  username: string | null;
  scopes: string[];
  status: ConnectedAccountStatus;
};

export type UpsertSecretInput = {
  connectedAccountId: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: string | null;
  encryptionKeyId: string;
};

export type OAuthNonceRecord = {
  nonce: string;
  userId: string;
  provider: ConnectedAccountProvider;
  surface: OAuthSurface;
  expiresAt: string;
};

export type ReserveOAuthNonceInput = {
  nonce: string;
  userId: string;
  provider: ConnectedAccountProvider;
  surface: OAuthSurface;
  expiresAt: string;
};

export type OAuthTokenBundle = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  platformAccountId: string;
  displayName: string | null;
  username: string | null;
};
