import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectedAccountRepository, ConnectedAccountRecord } from './ConnectedAccountRepository';
import type {
  ConnectedAccountProvider,
  ConnectedAccountSecretRecord,
  ConnectedAccountStatus,
  OAuthNonceRecord,
  OAuthSurface,
  ReserveOAuthNonceInput,
  UpsertConnectedAccountInput,
  UpsertSecretInput,
} from './domain/types';

type AccountRow = {
  id: string;
  user_id: string;
  provider: ConnectedAccountProvider;
  platform_account_id: string;
  display_name: string | null;
  username: string | null;
  scopes: string[] | null;
  status: ConnectedAccountStatus;
  last_health_check_at: string | null;
  last_health_error: string | null;
  created_at: string;
  updated_at: string;
};

type SecretRow = {
  connected_account_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  encryption_key_id: string;
  created_at: string;
  updated_at: string;
};

function mapAccount(row: AccountRow): ConnectedAccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    platformAccountId: row.platform_account_id,
    displayName: row.display_name,
    username: row.username,
    scopes: row.scopes ?? [],
    status: row.status,
    lastHealthCheckAt: row.last_health_check_at,
    lastHealthError: row.last_health_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSecret(row: SecretRow): ConnectedAccountSecretRecord {
  return {
    connectedAccountId: row.connected_account_id,
    accessTokenCiphertext: row.access_token_ciphertext,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    tokenExpiresAt: row.token_expires_at,
    encryptionKeyId: row.encryption_key_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseConnectedAccountRepository implements ConnectedAccountRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async listByUser(userId: string): Promise<ConnectedAccountRecord[]> {
    const { data, error } = await this.admin
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as AccountRow[]).map(mapAccount);
  }

  async getById(id: string): Promise<ConnectedAccountRecord | null> {
    const { data, error } = await this.admin
      .from('connected_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAccount(data as AccountRow) : null;
  }

  async findByUserProviderPlatform(
    userId: string,
    provider: ConnectedAccountProvider,
    platformAccountId: string,
  ): Promise<ConnectedAccountRecord | null> {
    const { data, error } = await this.admin
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('platform_account_id', platformAccountId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAccount(data as AccountRow) : null;
  }

  async upsertAccount(input: UpsertConnectedAccountInput): Promise<ConnectedAccountRecord> {
    const existing = await this.findByUserProviderPlatform(
      input.userId,
      input.provider,
      input.platformAccountId,
    );
    const now = new Date().toISOString();
    if (existing) {
      const { data, error } = await this.admin
        .from('connected_accounts')
        .update({
          display_name: input.displayName,
          username: input.username,
          scopes: input.scopes,
          status: input.status,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      return mapAccount(data as AccountRow);
    }
    const { data, error } = await this.admin
      .from('connected_accounts')
      .insert({
        user_id: input.userId,
        provider: input.provider,
        platform_account_id: input.platformAccountId,
        display_name: input.displayName,
        username: input.username,
        scopes: input.scopes,
        status: input.status,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapAccount(data as AccountRow);
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
    const body: Record<string, unknown> = {
      status: patch.status,
      updated_at: new Date().toISOString(),
    };
    if (patch.lastHealthCheckAt !== undefined) body.last_health_check_at = patch.lastHealthCheckAt;
    if (patch.lastHealthError !== undefined) body.last_health_error = patch.lastHealthError;
    if (patch.displayName !== undefined) body.display_name = patch.displayName;
    if (patch.username !== undefined) body.username = patch.username;
    if (patch.scopes !== undefined) body.scopes = patch.scopes;
    const { data, error } = await this.admin
      .from('connected_accounts')
      .update(body)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapAccount(data as AccountRow);
  }

  async upsertSecret(input: UpsertSecretInput): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.admin.from('connected_account_secrets').upsert(
      {
        connected_account_id: input.connectedAccountId,
        access_token_ciphertext: input.accessTokenCiphertext,
        refresh_token_ciphertext: input.refreshTokenCiphertext,
        token_expires_at: input.tokenExpiresAt,
        encryption_key_id: input.encryptionKeyId,
        updated_at: now,
      },
      { onConflict: 'connected_account_id' },
    );
    if (error) throw error;
  }

  async getSecret(connectedAccountId: string): Promise<ConnectedAccountSecretRecord | null> {
    const { data, error } = await this.admin
      .from('connected_account_secrets')
      .select('*')
      .eq('connected_account_id', connectedAccountId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapSecret(data as SecretRow) : null;
  }

  async deleteSecret(connectedAccountId: string): Promise<void> {
    const { error } = await this.admin
      .from('connected_account_secrets')
      .delete()
      .eq('connected_account_id', connectedAccountId);
    if (error) throw error;
  }

  async reserveOAuthNonce(input: ReserveOAuthNonceInput): Promise<void> {
    const { error } = await this.admin.from('connected_account_oauth_nonces').insert({
      nonce: input.nonce,
      user_id: input.userId,
      provider: input.provider,
      surface: input.surface,
      expires_at: input.expiresAt,
    });
    if (error) throw error;
  }

  async consumeOAuthNonce(nonce: string): Promise<OAuthNonceRecord | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.admin
      .from('connected_account_oauth_nonces')
      .update({ consumed_at: now })
      .eq('nonce', nonce)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .select('nonce, user_id, provider, surface, expires_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as {
      nonce: string;
      user_id: string;
      provider: ConnectedAccountProvider;
      surface: OAuthSurface;
      expires_at: string;
    };
    return {
      nonce: row.nonce,
      userId: row.user_id,
      provider: row.provider,
      surface: row.surface,
      expiresAt: row.expires_at,
    };
  }
}
