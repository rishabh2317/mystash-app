import { randomUUID } from 'node:crypto';
import type { ConnectedAccountRepository, ConnectedAccountRecord } from './ConnectedAccountRepository';
import type {
  ConnectedAccountProvider,
  ConnectedAccountSecretRecord,
  ConnectedAccountStatus,
  OAuthNonceRecord,
  ReserveOAuthNonceInput,
  UpsertConnectedAccountInput,
  UpsertSecretInput,
} from './domain/types';

export class InMemoryConnectedAccountRepository implements ConnectedAccountRepository {
  private accounts = new Map<string, ConnectedAccountRecord>();
  private secrets = new Map<string, ConnectedAccountSecretRecord>();
  private nonces = new Map<
    string,
    ReserveOAuthNonceInput & { consumedAt: string | null }
  >();

  async listByUser(userId: string): Promise<ConnectedAccountRecord[]> {
    return [...this.accounts.values()]
      .filter((a) => a.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getById(id: string): Promise<ConnectedAccountRecord | null> {
    return this.accounts.get(id) ?? null;
  }

  async findByUserProviderPlatform(
    userId: string,
    provider: ConnectedAccountProvider,
    platformAccountId: string,
  ): Promise<ConnectedAccountRecord | null> {
    for (const row of this.accounts.values()) {
      if (
        row.userId === userId &&
        row.provider === provider &&
        row.platformAccountId === platformAccountId
      ) {
        return row;
      }
    }
    return null;
  }

  async upsertAccount(input: UpsertConnectedAccountInput): Promise<ConnectedAccountRecord> {
    const existing = await this.findByUserProviderPlatform(
      input.userId,
      input.provider,
      input.platformAccountId,
    );
    const now = new Date().toISOString();
    if (existing) {
      const next: ConnectedAccountRecord = {
        ...existing,
        displayName: input.displayName,
        username: input.username,
        scopes: [...input.scopes],
        status: input.status,
        updatedAt: now,
      };
      this.accounts.set(existing.id, next);
      return next;
    }
    const row: ConnectedAccountRecord = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      platformAccountId: input.platformAccountId,
      displayName: input.displayName,
      username: input.username,
      scopes: [...input.scopes],
      status: input.status,
      lastHealthCheckAt: null,
      lastHealthError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(row.id, row);
    return row;
  }

  async updateStatus(
    id: string,
    patch: {
      status: ConnectedAccountStatus;
      lastHealthCheckAt?: string | null;
      lastHealthError?: string | null;
      displayName?: string | null;
      username?: string | null;
      scopes?: string[];
    },
  ): Promise<ConnectedAccountRecord> {
    const existing = this.accounts.get(id);
    if (!existing) throw new Error(`connected_account not found: ${id}`);
    const next: ConnectedAccountRecord = {
      ...existing,
      status: patch.status,
      lastHealthCheckAt:
        patch.lastHealthCheckAt === undefined ? existing.lastHealthCheckAt : patch.lastHealthCheckAt,
      lastHealthError:
        patch.lastHealthError === undefined ? existing.lastHealthError : patch.lastHealthError,
      displayName: patch.displayName === undefined ? existing.displayName : patch.displayName,
      username: patch.username === undefined ? existing.username : patch.username,
      scopes: patch.scopes === undefined ? existing.scopes : [...patch.scopes],
      updatedAt: new Date().toISOString(),
    };
    this.accounts.set(id, next);
    return next;
  }

  async upsertSecret(input: UpsertSecretInput): Promise<void> {
    const now = new Date().toISOString();
    const prev = this.secrets.get(input.connectedAccountId);
    this.secrets.set(input.connectedAccountId, {
      connectedAccountId: input.connectedAccountId,
      accessTokenCiphertext: input.accessTokenCiphertext,
      refreshTokenCiphertext: input.refreshTokenCiphertext,
      tokenExpiresAt: input.tokenExpiresAt,
      encryptionKeyId: input.encryptionKeyId,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getSecret(connectedAccountId: string): Promise<ConnectedAccountSecretRecord | null> {
    return this.secrets.get(connectedAccountId) ?? null;
  }

  async deleteSecret(connectedAccountId: string): Promise<void> {
    this.secrets.delete(connectedAccountId);
  }

  async reserveOAuthNonce(input: ReserveOAuthNonceInput): Promise<void> {
    if (this.nonces.has(input.nonce)) {
      throw new Error('OAuth nonce already reserved');
    }
    this.nonces.set(input.nonce, { ...input, consumedAt: null });
  }

  async consumeOAuthNonce(nonce: string): Promise<OAuthNonceRecord | null> {
    const row = this.nonces.get(nonce);
    if (!row || row.consumedAt) return null;
    if (Date.parse(row.expiresAt) <= Date.now()) return null;
    row.consumedAt = new Date().toISOString();
    return {
      nonce: row.nonce,
      userId: row.userId,
      provider: row.provider,
      surface: row.surface,
      expiresAt: row.expiresAt,
    };
  }
}
