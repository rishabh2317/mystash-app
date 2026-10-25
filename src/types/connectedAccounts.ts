/**
 * Types for connected Instagram/YouTube accounts (Phase 2).
 * Kept free of React Native imports so UI helpers can unit-test cleanly.
 */
export type ConnectedAccountProvider = 'youtube' | 'instagram';

export type ConnectedAccountStatus =
  | 'active'
  | 'needs_reauth'
  | 'revoked'
  | 'disconnected';

export type ConnectedAccountView = {
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
  linkingEnabled: boolean;
};

export type ConnectedAccountsSnapshot = {
  accounts: ConnectedAccountView[];
  providers: {
    youtube: { linkingEnabled: boolean };
    instagram: { linkingEnabled: boolean };
  };
};
