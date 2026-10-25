import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUTH_COPY, formatAuthError } from './authErrors';
import { isAuthEmailVerified } from './emailVerified';
import { MIN_PASSWORD_LENGTH, passwordMeetsPolicy } from './passwordPolicy';
import { canResendConfirmation, RESEND_COOLDOWN_MS } from './resendCooldown';
import {
  PENDING_CONFIRMATION_EMAIL_KEY,
  readPendingConfirmationEmail,
  writePendingConfirmationEmail,
} from './pendingAuth';

describe('auth errors and policy', () => {
  it('does not reveal whether an email is registered', () => {
    assert.equal(
      formatAuthError({ code: 'user_already_exists', message: 'User already registered' }, 'signup'),
      AUTH_COPY.genericSignUp,
    );
    assert.equal(formatAuthError({ message: 'User not found' }, 'recovery'), AUTH_COPY.genericRecovery);
  });

  it('preserves invalid credentials, unconfirmed, rate limit, and offline', () => {
    assert.equal(formatAuthError({ code: 'invalid_credentials' }, 'signin'), AUTH_COPY.invalidCredentials);
    assert.equal(formatAuthError({ code: 'email_not_confirmed' }, 'signin'), AUTH_COPY.emailNotConfirmed);
    assert.equal(formatAuthError({ code: 'over_email_send_rate_limit' }, 'resend'), AUTH_COPY.rateLimited);
    assert.equal(formatAuthError({ message: 'Network request failed' }, 'signin'), AUTH_COPY.offline);
  });

  it('maps a PKCE verifier miss to the Google failure copy', () => {
    assert.equal(
      formatAuthError({ message: 'PKCE code verifier not found in storage' }, 'callback'),
      AUTH_COPY.googleFailed,
    );
  });

  it('keeps Profile welcome copy for sign-in and create-account modes', () => {
    assert.equal(AUTH_COPY.welcomeTitle, 'Welcome to Mystash');
    assert.equal(AUTH_COPY.landingHeadline, 'Your shopping in one place');
    assert.equal(AUTH_COPY.formSignInTitle, 'Welcome back');
    assert.equal(
      AUTH_COPY.welcomeSignIn,
      'Sign in to manage profile, wishlist, and creator earnings.',
    );
    assert.equal(
      AUTH_COPY.welcomeSignUp,
      'Create an account to save products, build Collections, and manage your creator profile.',
    );
    assert.equal(AUTH_COPY.forgotPassword, 'Forgot password?');
    assert.equal(AUTH_COPY.displayName, 'Display name');
    assert.equal(AUTH_COPY.terms, 'Terms');
  });

  it('aligns the password minimum at 8 characters', () => {
    assert.equal(MIN_PASSWORD_LENGTH, 8);
    assert.equal(passwordMeetsPolicy('1234567'), false);
    assert.equal(passwordMeetsPolicy('12345678'), true);
  });

  it('enforces resend cooldown', () => {
    const now = 1_000_000;
    assert.equal(canResendConfirmation(null, now), true);
    assert.equal(canResendConfirmation(now - 1_000, now), false);
    assert.equal(canResendConfirmation(now - RESEND_COOLDOWN_MS, now), true);
  });

  it('does not treat an unverified email session as verified', () => {
    assert.equal(isAuthEmailVerified({ email_confirmed_at: null }), false);
    assert.equal(isAuthEmailVerified({ email_confirmed_at: '2026-01-01T00:00:00Z' }), true);
    assert.equal(
      isAuthEmailVerified({
        identities: [{ provider: 'google', identity_data: { email_verified: true } }],
      }),
      true,
    );
    assert.equal(
      isAuthEmailVerified({
        identities: [{ provider: 'google', identity_data: { email_verified: false } }],
      }),
      false,
    );
  });

  it('stores pending confirmation email for restart', async () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => mem.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        mem.set(key, value);
      },
      removeItem: async (key: string) => {
        mem.delete(key);
      },
    };
    await writePendingConfirmationEmail(storage, '  A@B.com ');
    assert.equal(await readPendingConfirmationEmail(storage), 'a@b.com');
    assert.equal(mem.get(PENDING_CONFIRMATION_EMAIL_KEY), 'a@b.com');
  });
});
