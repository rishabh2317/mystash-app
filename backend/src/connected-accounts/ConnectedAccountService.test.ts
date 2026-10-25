import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { decryptToken, encryptToken, redactTokenForLog } from './tokenCrypto';
import { createOAuthState, parseOAuthState } from './oauthState';
import { InMemoryConnectedAccountRepository } from './InMemoryConnectedAccountRepository';
import { ConnectedAccountService } from './ConnectedAccountService';
import type { ConnectedAccountOAuthProvider } from './providers/types';
import type { ConnectedAccountProvider, OAuthTokenBundle } from './domain/types';
import { YouTubeOAuthProvider } from './providers/YouTubeOAuthProvider';
import { assertYouTubeOAuthRedirectUri } from './oauthReturn';
import type { EnqueueEventInput } from '../notifications/domain/types';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

describe('tokenCrypto', () => {
  it('round-trips and redacts', () => {
    const packed = encryptToken('secret-token', TEST_KEY);
    assert.notEqual(packed, 'secret-token');
    assert.equal(decryptToken(packed, TEST_KEY), 'secret-token');
    assert.equal(redactTokenForLog(packed), '[redacted]');
  });
});

describe('oauthState', () => {
  it('binds user and provider with expiry', () => {
    const state = createOAuthState(
      { userId: 'u1', provider: 'youtube', nonce: 'abc', surface: 'native' },
      Date.now(),
      'state-secret',
    );
    const parsed = parseOAuthState(state, {
      secret: 'state-secret',
      expectUserId: 'u1',
      expectProvider: 'youtube',
    });
    assert.equal(parsed.userId, 'u1');
    assert.equal(parsed.provider, 'youtube');
    assert.equal(parsed.surface, 'native');
    assert.throws(() =>
      parseOAuthState(state, { secret: 'state-secret', expectUserId: 'other' }),
    );
  });
});

function mockYouTubeProvider(bundle?: Partial<OAuthTokenBundle>): ConnectedAccountOAuthProvider {
  return {
    provider: 'youtube',
    buildAuthorizeUrl: ({ state }) => ({
      authorizeUrl: `https://example.test/auth?state=${encodeURIComponent(state)}`,
    }),
    exchangeCode: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      platformAccountId: 'channel-1',
      displayName: 'Demo Channel',
      username: '@demo',
      ...bundle,
    }),
    healthCheck: async () => ({
      ok: true,
      platformAccountId: 'channel-1',
      displayName: 'Demo Channel',
      username: '@demo',
      error: null,
    }),
    revoke: async () => undefined,
  };
}

describe('ConnectedAccountService', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'CONNECTED_ACCOUNTS_YOUTUBE_ENABLED',
      'CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED',
      'CONNECTED_ACCOUNTS_ENCRYPTION_KEY',
      'CONNECTED_ACCOUNTS_OAUTH_STATE_SECRET',
      'CONNECTED_ACCOUNTS_WEB_RETURN_ORIGIN',
      'YOUTUBE_OAUTH_CLIENT_ID',
      'YOUTUBE_OAUTH_CLIENT_SECRET',
      'YOUTUBE_OAUTH_REDIRECT_URI',
    ]) {
      prev[key] = process.env[key];
    }
    process.env.CONNECTED_ACCOUNTS_ENCRYPTION_KEY = TEST_KEY;
    process.env.CONNECTED_ACCOUNTS_OAUTH_STATE_SECRET = 'state-secret';
    process.env.CONNECTED_ACCOUNTS_YOUTUBE_ENABLED = 'true';
    process.env.CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED = 'false';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('blocks start when provider flag is off', async () => {
    const repo = new InMemoryConnectedAccountRepository();
    const providers = new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
      ['youtube', mockYouTubeProvider()],
    ]);
    const svc = new ConnectedAccountService(repo, providers);
    process.env.CONNECTED_ACCOUNTS_YOUTUBE_ENABLED = 'false';
    await assert.rejects(() => svc.startOAuth('user-1', 'youtube'), /disabled/i);
  });

  it('completes oauth, never exposes ciphertext on list, and disconnect wipes secrets', async () => {
    const repo = new InMemoryConnectedAccountRepository();
    const providers = new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
      ['youtube', mockYouTubeProvider()],
    ]);
    const svc = new ConnectedAccountService(repo, providers);

    const started = await svc.startOAuth('user-1', 'youtube');
    assert.match(started.authorizeUrl, /example\.test/);

    const account = await svc.completeOAuth('user-1', 'youtube', {
      code: 'auth-code',
      state: started.state,
    });
    assert.equal(account.platformAccountId, 'channel-1');
    assert.equal(account.status, 'active');
    assert.equal(account.linkingEnabled, true);
    assert.ok(!('accessToken' in account));

    const listed = await svc.listForUser('user-1');
    assert.equal(listed.length, 1);
    assert.equal(JSON.stringify(listed).includes('access'), false);

    const secretBefore = await repo.getSecret(account.id);
    assert.ok(secretBefore);
    assert.notEqual(secretBefore!.accessTokenCiphertext, 'access');

    const disconnected = await svc.disconnect('user-1', account.id);
    assert.equal(disconnected.status, 'disconnected');
    assert.equal(await repo.getSecret(account.id), null);
  });

  it('health probe updates status', async () => {
    const repo = new InMemoryConnectedAccountRepository();
    const providers = new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
      ['youtube', mockYouTubeProvider()],
    ]);
    const svc = new ConnectedAccountService(repo, providers);
    const started = await svc.startOAuth('user-1', 'youtube');
    const account = await svc.completeOAuth('user-1', 'youtube', {
      code: 'c',
      state: started.state,
    });
    const healthy = await svc.healthCheck('user-1', account.id);
    assert.equal(healthy.status, 'active');
    assert.ok(healthy.lastHealthCheckAt);
  });

  it('notifies once when an account moves into needs_reauth', async () => {
    const repo = new InMemoryConnectedAccountRepository();
    const failing: ConnectedAccountOAuthProvider = {
      ...mockYouTubeProvider(),
      healthCheck: async () => ({
        ok: false,
        platformAccountId: 'channel-1',
        displayName: null,
        username: null,
        error: 'revoked',
      }),
    };
    const emitted: EnqueueEventInput[] = [];
    const svc = new ConnectedAccountService(
      repo,
      new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([['youtube', failing]]),
      {
        emitSafely: async (input) => {
          emitted.push(input);
          return 'enqueued';
        },
      },
    );
    const started = await svc.startOAuth('user-1', 'youtube');
    const account = await svc.completeOAuth('user-1', 'youtube', { code: 'c', state: started.state });

    const first = await svc.healthCheck('user-1', account.id);
    assert.equal(first.status, 'needs_reauth');
    await svc.healthCheck('user-1', account.id);

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].eventType, 'connected_account.needs_reauth');
    assert.equal(emitted[0].recipientUserId, 'user-1');
    assert.equal(emitted[0].occurredAt, first.lastHealthCheckAt);
    assert.deepEqual(emitted[0].payload, { connectedAccountId: account.id, provider: 'youtube' });
  });

  it('refreshes an expired access token without returning it', async () => {
    const repo = new InMemoryConnectedAccountRepository();
    let refreshed = 0;
    const providers = new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
      [
        'youtube',
        {
          ...mockYouTubeProvider(),
          refreshAccessToken: async () => {
            refreshed += 1;
            return {
              accessToken: 'access-2',
              refreshToken: null,
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            };
          },
        },
      ],
    ]);
    const svc = new ConnectedAccountService(repo, providers);
    const started = await svc.startOAuth('user-1', 'youtube');
    const account = await svc.completeOAuth('user-1', 'youtube', { code: 'c', state: started.state });
    const secret = await repo.getSecret(account.id);
    await repo.upsertSecret({
      connectedAccountId: account.id,
      accessTokenCiphertext: secret!.accessTokenCiphertext,
      refreshTokenCiphertext: secret!.refreshTokenCiphertext,
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      encryptionKeyId: secret!.encryptionKeyId,
    });
    const token = await svc.ensureFreshAccessToken(account.id);
    assert.equal(token, 'access-2');
    assert.equal(refreshed, 1);
    const listed = JSON.stringify(await svc.listForUser('user-1'));
    assert.equal(listed.includes('access-2'), false);
  });

  it('exchanges on the backend callback and returns the app without the code', async () => {
    const repo = new InMemoryConnectedAccountRepository();
    let exchanges = 0;
    const providers = new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
      [
        'youtube',
        {
          ...mockYouTubeProvider(),
          exchangeCode: async () => {
            exchanges += 1;
            return {
              accessToken: 'access',
              refreshToken: 'refresh',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
              platformAccountId: 'channel-1',
              displayName: 'Demo Channel',
              username: '@demo',
            };
          },
        },
      ],
    ]);
    const svc = new ConnectedAccountService(repo, providers);
    const started = await svc.startOAuth('user-1', 'youtube', 'native');
    const done = await svc.finishOAuthRedirect({
      provider: 'youtube',
      code: 'auth-code',
      state: started.state,
      oauthError: null,
    });
    assert.equal(exchanges, 1);
    assert.match(done.redirectUrl, /^mystash:\/\/connected-accounts\/callback\?/);
    assert.match(done.redirectUrl, /status=connected/);
    assert.equal(done.redirectUrl.includes('auth-code'), false);
    assert.equal(done.redirectUrl.includes('access'), false);
    const account = (await svc.listForUser('user-1'))[0];
    assert.equal(account?.status, 'active');
    assert.ok(await repo.getSecret(account!.id));

    const replay = await svc.finishOAuthRedirect({
      provider: 'youtube',
      code: 'auth-code',
      state: started.state,
      oauthError: null,
    });
    assert.equal(exchanges, 1);
    assert.match(replay.redirectUrl, /error=invalid_state/);
    assert.equal(replay.redirectUrl.includes('auth-code'), false);
  });

  it('returns Expo web to the configured origin', async () => {
    process.env.CONNECTED_ACCOUNTS_WEB_RETURN_ORIGIN = 'http://localhost:8081';
    const repo = new InMemoryConnectedAccountRepository();
    const providers = new Map<ConnectedAccountProvider, ConnectedAccountOAuthProvider>([
      ['youtube', mockYouTubeProvider()],
    ]);
    const svc = new ConnectedAccountService(repo, providers);
    const started = await svc.startOAuth('user-1', 'youtube', 'web');
    const done = await svc.finishOAuthRedirect({
      provider: 'youtube',
      code: 'auth-code',
      state: started.state,
      oauthError: null,
    });
    assert.equal(
      done.redirectUrl.startsWith('http://localhost:8081/connected-accounts/callback?'),
      true,
    );
    assert.match(done.redirectUrl, /status=connected/);
    assert.equal(done.redirectUrl.includes('auth-code'), false);
  });
});

describe('YouTube OAuth redirect URI', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'YOUTUBE_OAUTH_CLIENT_ID',
      'YOUTUBE_OAUTH_CLIENT_SECRET',
      'YOUTUBE_OAUTH_REDIRECT_URI',
    ]) {
      prev[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects the app scheme and accepts the backend callback', () => {
    assert.throws(
      () => assertYouTubeOAuthRedirectUri('mystash://connected-accounts/callback'),
      /https/,
    );
    assert.doesNotThrow(() =>
      assertYouTubeOAuthRedirectUri('http://localhost:8787/connected-accounts/youtube/oauth/callback'),
    );
    process.env.YOUTUBE_OAUTH_CLIENT_ID = 'client';
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'secret';
    process.env.YOUTUBE_OAUTH_REDIRECT_URI =
      'https://api.example.test/connected-accounts/youtube/oauth/callback';
    const url = new YouTubeOAuthProvider().buildAuthorizeUrl({ state: 'state-1' }).authorizeUrl;
    const parsed = new URL(url);
    assert.equal(
      parsed.searchParams.get('redirect_uri'),
      'https://api.example.test/connected-accounts/youtube/oauth/callback',
    );
    assert.equal(parsed.searchParams.get('redirect_uri')?.startsWith('mystash:'), false);
  });
});
