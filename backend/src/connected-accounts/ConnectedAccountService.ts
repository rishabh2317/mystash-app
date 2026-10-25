import { randomBytes } from 'node:crypto';
import type { ConnectedAccountRecord, ConnectedAccountRepository } from './ConnectedAccountRepository';
import {
  getConnectedAccountsEncryptionConfigured,
  isConnectedAccountProviderEnabled,
} from './config';
import type {
  ConnectedAccountProvider,
  ConnectedAccountPublic,
  OAuthSurface,
} from './domain/types';
import { createOAuthState, parseOAuthState, OAuthStateError } from './oauthState';
import {
  appendOAuthReturnQuery,
  oauthReturnUrl,
  safeOAuthErrorCode,
} from './oauthReturn';
import type { ConnectedAccountOAuthProvider } from './providers/types';
import {
  NOOP_NOTIFICATION_EMITTER,
  needsReauthEvent,
  type NotificationEmitter,
} from '../notifications/producers';
import {
  decryptToken,
  encryptToken,
  getEncryptionKeyId,
  TokenCryptoError,
} from './tokenCrypto';

export class ConnectedAccountServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ConnectedAccountServiceError';
  }
}

export class ConnectedAccountService {
  constructor(
    private readonly repo: ConnectedAccountRepository,
    private readonly providers: Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>,
    private readonly notifications: NotificationEmitter = NOOP_NOTIFICATION_EMITTER,
  ) {}

  /** Notifies only on the transition into needs_reauth, not on repeated probes. */
  private async markNeedsReauth(
    account: ConnectedAccountRecord,
    patch: { lastHealthCheckAt: string; lastHealthError: string | null },
  ): Promise<ConnectedAccountRecord> {
    const updated = await this.repo.updateStatus(account.id, { status: 'needs_reauth', ...patch });
    if (account.status !== 'needs_reauth') {
      await this.notifications.emitSafely(
        needsReauthEvent({
          connectedAccountId: account.id,
          userId: account.userId,
          transitionAt: patch.lastHealthCheckAt,
          provider: account.provider,
        }),
      );
    }
    return updated;
  }

  private toPublic(
    row: Awaited<ReturnType<ConnectedAccountRepository['listByUser']>>[number],
  ): ConnectedAccountPublic {
    return {
      ...row,
      linkingEnabled: isConnectedAccountProviderEnabled(row.provider),
    };
  }

  async listForUser(userId: string): Promise<ConnectedAccountPublic[]> {
    const rows = await this.repo.listByUser(userId);
    return rows.map((r) => this.toPublic(r));
  }

  async startOAuth(
    userId: string,
    provider: ConnectedAccountProvider,
    surface: OAuthSurface = 'native',
  ): Promise<{ authorizeUrl: string; state: string }> {
    if (!isConnectedAccountProviderEnabled(provider)) {
      throw new ConnectedAccountServiceError(
        `${provider} account linking is disabled until VERIFY completes (see docs/creator-ecosystem-phase-2-verify.md)`,
        403,
      );
    }
    if (!getConnectedAccountsEncryptionConfigured()) {
      throw new ConnectedAccountServiceError(
        'CONNECTED_ACCOUNTS_ENCRYPTION_KEY is required before linking',
        503,
      );
    }
    if (surface !== 'native' && surface !== 'web') {
      throw new ConnectedAccountServiceError('Invalid OAuth surface', 400);
    }
    try {
      oauthReturnUrl(surface);
    } catch (e) {
      throw new ConnectedAccountServiceError(
        e instanceof Error ? e.message : 'OAuth return URL is not configured',
        503,
      );
    }
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new ConnectedAccountServiceError(`Unknown provider: ${provider}`, 400);
    }
    const nonce = randomBytes(16).toString('hex');
    let state: string;
    try {
      state = createOAuthState({ userId, provider, nonce, surface });
    } catch (e) {
      throw new ConnectedAccountServiceError(
        e instanceof Error ? e.message : 'Could not create OAuth state',
        503,
      );
    }
    const parsed = parseOAuthState(state, { expectUserId: userId, expectProvider: provider });
    await this.repo.reserveOAuthNonce({
      nonce,
      userId,
      provider,
      surface,
      expiresAt: new Date(parsed.exp).toISOString(),
    });
    try {
      const { authorizeUrl } = adapter.buildAuthorizeUrl({ state });
      return { authorizeUrl, state };
    } catch (e) {
      throw new ConnectedAccountServiceError(
        e instanceof Error ? e.message : 'Could not start OAuth',
        503,
      );
    }
  }

  async completeOAuth(
    userId: string,
    provider: ConnectedAccountProvider,
    input: { code: string; state: string },
  ): Promise<ConnectedAccountPublic> {
    if (!isConnectedAccountProviderEnabled(provider)) {
      throw new ConnectedAccountServiceError(`${provider} account linking is disabled`, 403);
    }
    let payload;
    try {
      payload = parseOAuthState(input.state, { expectUserId: userId, expectProvider: provider });
    } catch (e) {
      const msg = e instanceof OAuthStateError ? e.message : 'Invalid OAuth state';
      throw new ConnectedAccountServiceError(msg, 400);
    }
    const consumed = await this.repo.consumeOAuthNonce(payload.nonce);
    if (
      !consumed ||
      consumed.userId !== userId ||
      consumed.provider !== provider ||
      consumed.surface !== payload.surface
    ) {
      throw new ConnectedAccountServiceError('Invalid or reused OAuth state', 400);
    }
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new ConnectedAccountServiceError(`Unknown provider: ${provider}`, 400);
    }
    let bundle;
    try {
      bundle = await adapter.exchangeCode({ code: input.code });
    } catch (e) {
      throw new ConnectedAccountServiceError(
        e instanceof Error ? e.message : 'OAuth exchange failed',
        502,
      );
    }
    let accessCipher: string;
    let refreshCipher: string | null;
    try {
      accessCipher = encryptToken(bundle.accessToken);
      refreshCipher = bundle.refreshToken ? encryptToken(bundle.refreshToken) : null;
    } catch (e) {
      throw new ConnectedAccountServiceError(
        e instanceof TokenCryptoError ? e.message : 'Token encryption failed',
        503,
      );
    }
    const account = await this.repo.upsertAccount({
      userId,
      provider,
      platformAccountId: bundle.platformAccountId,
      displayName: bundle.displayName,
      username: bundle.username,
      scopes: bundle.scopes,
      status: 'active',
    });
    await this.repo.upsertSecret({
      connectedAccountId: account.id,
      accessTokenCiphertext: accessCipher,
      refreshTokenCiphertext: refreshCipher,
      tokenExpiresAt: bundle.expiresAt,
      encryptionKeyId: getEncryptionKeyId(),
    });
    return this.toPublic(account);
  }

  /**
   * Google redirects here with code+state. Exchange and store tokens, then
   * send the browser back to the app with status only.
   */
  async finishOAuthRedirect(input: {
    provider: ConnectedAccountProvider;
    code: string | null;
    state: string | null;
    oauthError: string | null;
  }): Promise<{ redirectUrl: string }> {
    if (!input.state?.trim()) {
      throw new ConnectedAccountServiceError('Invalid OAuth state', 400);
    }
    let payload;
    try {
      payload = parseOAuthState(input.state.trim());
    } catch (e) {
      const msg = e instanceof OAuthStateError ? e.message : 'Invalid OAuth state';
      throw new ConnectedAccountServiceError(msg, 400);
    }
    let base: string;
    try {
      base = oauthReturnUrl(payload.surface);
    } catch (e) {
      throw new ConnectedAccountServiceError(
        e instanceof Error ? e.message : 'OAuth return URL is not configured',
        503,
      );
    }
    const errorRedirect = (error: string) => ({
      redirectUrl: appendOAuthReturnQuery(base, {
        status: 'error',
        error: safeOAuthErrorCode(error),
      }),
    });
    if (payload.provider !== input.provider) {
      await this.repo.consumeOAuthNonce(payload.nonce);
      return errorRedirect('invalid_state');
    }
    if (input.oauthError) {
      await this.repo.consumeOAuthNonce(payload.nonce);
      return errorRedirect(input.oauthError);
    }
    if (!input.code?.trim()) {
      await this.repo.consumeOAuthNonce(payload.nonce);
      return errorRedirect('missing_code');
    }
    try {
      await this.completeOAuth(payload.userId, input.provider, {
        code: input.code.trim(),
        state: input.state.trim(),
      });
      return {
        redirectUrl: appendOAuthReturnQuery(base, { status: 'connected' }),
      };
    } catch (e) {
      const message = e instanceof ConnectedAccountServiceError ? e.message : 'exchange_failed';
      return errorRedirect(message);
    }
  }

  async disconnect(userId: string, accountId: string): Promise<ConnectedAccountPublic> {
    const account = await this.repo.getById(accountId);
    if (!account || account.userId !== userId) {
      throw new ConnectedAccountServiceError('Connected account not found', 404);
    }
    const secret = await this.repo.getSecret(accountId);
    if (secret) {
      const adapter = this.providers.get(account.provider);
      if (adapter?.revoke) {
        try {
          const access = decryptToken(secret.accessTokenCiphertext);
          await adapter.revoke({ accessToken: access });
        } catch {
          /* wipe locally anyway */
        }
      }
      await this.repo.deleteSecret(accountId);
    }
    const updated = await this.repo.updateStatus(accountId, {
      status: 'disconnected',
      lastHealthError: null,
    });
    return this.toPublic(updated);
  }

  async startReauth(
    userId: string,
    accountId: string,
    surface: OAuthSurface = 'native',
  ): Promise<{ authorizeUrl: string; state: string }> {
    const account = await this.repo.getById(accountId);
    if (!account || account.userId !== userId) {
      throw new ConnectedAccountServiceError('Connected account not found', 404);
    }
    return this.startOAuth(userId, account.provider, surface);
  }

  async healthCheck(userId: string, accountId: string): Promise<ConnectedAccountPublic> {
    const account = await this.repo.getById(accountId);
    if (!account || account.userId !== userId) {
      throw new ConnectedAccountServiceError('Connected account not found', 404);
    }
    if (account.status === 'disconnected') {
      throw new ConnectedAccountServiceError('Account is disconnected', 400);
    }
    const secret = await this.repo.getSecret(accountId);
    if (!secret) {
      const updated = await this.markNeedsReauth(account, {
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthError: 'Missing credentials',
      });
      return this.toPublic(updated);
    }
    const adapter = this.providers.get(account.provider);
    if (!adapter) {
      throw new ConnectedAccountServiceError(`Unknown provider: ${account.provider}`, 400);
    }
    let accessToken: string;
    try {
      accessToken = await this.ensureFreshAccessToken(account.id);
    } catch (e) {
      if (e instanceof ConnectedAccountServiceError && e.statusCode === 401) {
        const updated = await this.repo.getById(account.id);
        if (updated) return this.toPublic(updated);
      }
      throw e;
    }
    if (!accessToken) {
      const updated = await this.markNeedsReauth(account, {
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthError: 'Missing credentials',
      });
      return this.toPublic(updated);
    }
    const probe = await adapter.healthCheck({ accessToken });
    const now = new Date().toISOString();
    if (!probe.ok) {
      const updated = await this.markNeedsReauth(account, {
        lastHealthCheckAt: now,
        lastHealthError: probe.error,
      });
      return this.toPublic(updated);
    }
    const updated = await this.repo.updateStatus(accountId, {
      status: 'active',
      lastHealthCheckAt: now,
      lastHealthError: null,
      displayName: probe.displayName ?? account.displayName,
      username: probe.username ?? account.username,
    });
    return this.toPublic(updated);
  }

  /**
   * Returns a usable access token, refreshing server-side when the stored token is
   * near expiry. Never logs token material.
   */
  async ensureFreshAccessToken(accountId: string, skewMs = 90_000): Promise<string> {
    const account = await this.repo.getById(accountId);
    if (!account || account.status === 'disconnected') {
      throw new ConnectedAccountServiceError('Connected account not found', 404);
    }
    const secret = await this.repo.getSecret(accountId);
    if (!secret) {
      await this.markNeedsReauth(account, {
        lastHealthError: 'Missing credentials',
        lastHealthCheckAt: new Date().toISOString(),
      });
      throw new ConnectedAccountServiceError('Reconnect this account', 401);
    }
    let accessToken: string;
    let refreshToken: string | null = null;
    try {
      accessToken = decryptToken(secret.accessTokenCiphertext);
      refreshToken = secret.refreshTokenCiphertext
        ? decryptToken(secret.refreshTokenCiphertext)
        : null;
    } catch {
      await this.markNeedsReauth(account, {
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthError: 'Could not decrypt credentials',
      });
      throw new ConnectedAccountServiceError('Reconnect this account', 401);
    }
    const expiresMs = secret.tokenExpiresAt ? Date.parse(secret.tokenExpiresAt) : Number.POSITIVE_INFINITY;
    if (expiresMs - Date.now() > skewMs) return accessToken;
    const adapter = this.providers.get(account.provider);
    if (!refreshToken || !adapter?.refreshAccessToken) {
      await this.markNeedsReauth(account, {
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthError: 'Access token expired',
      });
      throw new ConnectedAccountServiceError('Reconnect this account', 401);
    }
    try {
      const next = await adapter.refreshAccessToken({ refreshToken });
      await this.repo.upsertSecret({
        connectedAccountId: accountId,
        accessTokenCiphertext: encryptToken(next.accessToken),
        refreshTokenCiphertext: encryptToken(next.refreshToken ?? refreshToken),
        tokenExpiresAt: next.expiresAt,
        encryptionKeyId: getEncryptionKeyId(),
      });
      return next.accessToken;
    } catch {
      await this.markNeedsReauth(account, {
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthError: 'Token refresh failed',
      });
      throw new ConnectedAccountServiceError('Reconnect this account', 401);
    }
  }
}
