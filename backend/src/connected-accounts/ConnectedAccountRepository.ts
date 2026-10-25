import type {
  ConnectedAccountProvider,
  ConnectedAccountPublic,
  ConnectedAccountSecretRecord,
  ConnectedAccountStatus,
  OAuthNonceRecord,
  ReserveOAuthNonceInput,
  UpsertConnectedAccountInput,
  UpsertSecretInput,
} from './domain/types';

export type ConnectedAccountRecord = Omit<ConnectedAccountPublic, 'linkingEnabled'>;

export interface ConnectedAccountRepository {
  listByUser(userId: string): Promise<ConnectedAccountRecord[]>;
  getById(id: string): Promise<ConnectedAccountRecord | null>;
  upsertAccount(input: UpsertConnectedAccountInput): Promise<ConnectedAccountRecord>;
  updateStatus(
    id: string,
    patch: {
      status: ConnectedAccountStatus;
      lastHealthCheckAt?: string | null;
      lastHealthError?: string | null;
      displayName?: string | null;
      username?: string | null;
      scopes?: string[];
    },
  ): Promise<ConnectedAccountRecord>;
  upsertSecret(input: UpsertSecretInput): Promise<void>;
  getSecret(connectedAccountId: string): Promise<ConnectedAccountSecretRecord | null>;
  deleteSecret(connectedAccountId: string): Promise<void>;
  findByUserProviderPlatform(
    userId: string,
    provider: ConnectedAccountProvider,
    platformAccountId: string,
  ): Promise<ConnectedAccountRecord | null>;
  reserveOAuthNonce(input: ReserveOAuthNonceInput): Promise<void>;
  consumeOAuthNonce(nonce: string): Promise<OAuthNonceRecord | null>;
}
