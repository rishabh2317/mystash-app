import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AUTH_COPY } from './authErrors';
import {
  classifyAuthCallback,
  completeAuthCallback,
  getAuthParamsFromUrl,
  resetAuthCallbackExchangesForTests,
  type AuthCallbackDeps,
} from './authCallback';
import {
  beginInAppAuthSession,
  endInAppAuthSession,
  interpretAuthSessionResult,
  resetInAppAuthSessionForTests,
  rewriteNativeAuthCallbackPath,
} from './oauthCallbackOwnership';

function deps(overrides: Partial<AuthCallbackDeps> = {}): AuthCallbackDeps {
  return {
    getSession: async () => ({ session: null }),
    exchangeCodeForSession: async () => ({ error: null, session: { user: { id: 'u1' } } }),
    verifyOtp: async () => ({ error: { message: 'unused' }, session: null }),
    ...overrides,
  };
}

describe('auth callback', () => {
  beforeEach(() => {
    resetAuthCallbackExchangesForTests();
    resetInAppAuthSessionForTests();
  });

  it('classifies PKCE, OTP, recovery, and errors without implicit tokens', () => {
    assert.equal(classifyAuthCallback({ code: 'abc' }).kind, 'pkce');
    assert.deepEqual(classifyAuthCallback({ token_hash: 'h', type: 'signup' }).kind, 'otp');
    const recovery = classifyAuthCallback({ code: 'x', type: 'recovery' });
    assert.equal(recovery.kind, 'pkce');
    if (recovery.kind === 'pkce') assert.equal(recovery.recovery, true);
    assert.equal(classifyAuthCallback({ error: 'access_denied' }).kind, 'error');
    assert.equal(classifyAuthCallback({}).kind, 'none');
  });

  it('exchanges a confirmation code and restores a session', async () => {
    const result = await completeAuthCallback(deps({
      exchangeCodeForSession: async (code) => {
        assert.equal(code, 'pkce-code');
        return { error: null, session: { user: { id: 'u1' } } };
      },
    }), { code: 'pkce-code', type: 'signup' });
    assert.equal(result.status, 'signed_in');
  });

  it('treats recovery callbacks as password recovery', async () => {
    const result = await completeAuthCallback(
      deps({
        verifyOtp: async () => ({ error: null, session: { user: { id: 'u1' } } }),
      }),
      { token_hash: 'th', type: 'recovery' },
    );
    assert.equal(result.status, 'password_recovery');
  });

  it('maps expired and invalid links', async () => {
    const expired = await completeAuthCallback(
      deps({
        exchangeCodeForSession: async () => ({
          error: { code: 'otp_expired', message: 'expired' },
          session: null,
        }),
      }),
      { code: 'stale' },
    );
    assert.equal(expired.status, 'error');
    assert.equal(expired.message, AUTH_COPY.expiredLink);
  });

  it('exchanges a particular authorization code at most once', async () => {
    let exchanges = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shared = deps({
      exchangeCodeForSession: async () => {
        exchanges += 1;
        await gate;
        return { error: null, session: { user: { id: 'u1' } } };
      },
    });
    const first = completeAuthCallback(shared, { code: 'same-code' });
    const second = completeAuthCallback(shared, { code: 'same-code' });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(exchanges, 1);
    assert.equal(a.status, 'signed_in');
    assert.equal(b.status, 'signed_in');
    assert.equal(a.duplicate === true || b.duplicate === true, true);
    const again = await completeAuthCallback(shared, { code: 'same-code' });
    assert.equal(exchanges, 1);
    assert.equal(again.duplicate, true);
  });

  it('does not treat an unrelated existing session as success for a failed new login', async () => {
    const result = await completeAuthCallback(
      deps({
        getSession: async () => ({ session: { user: { id: 'already-in' } } }),
        exchangeCodeForSession: async () => ({
          error: { message: 'PKCE code verifier not found in storage' },
          session: null,
        }),
      }),
      { code: 'new-failed-code' },
    );
    assert.equal(result.status, 'error');
    assert.equal(result.message, AUTH_COPY.googleFailed);
  });

  it('returns a missing-verifier failure when no exchange has succeeded', async () => {
    const result = await completeAuthCallback(
      deps({
        exchangeCodeForSession: async () => ({
          error: { message: 'PKCE code verifier not found in storage' },
          session: null,
        }),
      }),
      { code: 'no-verifier' },
    );
    assert.equal(result.status, 'error');
    assert.equal(result.message, AUTH_COPY.googleFailed);
  });

  it('classifies cancellation separately from a missing callback URL', () => {
    assert.equal(interpretAuthSessionResult({ type: 'cancel' }).kind, 'cancel');
    assert.equal(interpretAuthSessionResult({ type: 'dismiss' }).kind, 'cancel');
    assert.equal(interpretAuthSessionResult({ type: 'success' }).kind, 'error');
    const ok = interpretAuthSessionResult({ type: 'success', url: 'mystash://auth/callback?code=x' });
    assert.equal(ok.kind, 'success');
  });

  it('keeps warm in-app OAuth callbacks off Expo Router and leaves cold/email links', () => {
    const url = 'mystash://auth/callback?code=abc';
    assert.equal(rewriteNativeAuthCallbackPath(url, false), undefined);
    beginInAppAuthSession();
    assert.equal(rewriteNativeAuthCallbackPath(url, false), null);
    assert.equal(rewriteNativeAuthCallbackPath(url, true), undefined);
    endInAppAuthSession();
    assert.equal(rewriteNativeAuthCallbackPath(url, false), undefined);
    assert.equal(rewriteNativeAuthCallbackPath('mystash://connected-accounts/callback', false), undefined);
  });

  it('parses query params without requiring hash tokens', () => {
    const params = getAuthParamsFromUrl('mystash://auth/callback?code=abc&type=signup');
    assert.equal(params.code, 'abc');
    assert.equal(params.type, 'signup');
    assert.equal(params.access_token, undefined);
  });
});
