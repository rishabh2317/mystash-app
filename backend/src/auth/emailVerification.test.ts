import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMAIL_NOT_VERIFIED,
  UnverifiedEmailError,
  assertEmailVerified,
  isAuthEmailVerified,
} from './emailVerification';

describe('backend email verification policy', () => {
  it('rejects unverified email/password users', () => {
    assert.equal(isAuthEmailVerified({ email_confirmed_at: null, confirmed_at: null }), false);
    assert.equal(EMAIL_NOT_VERIFIED, 'EMAIL_NOT_VERIFIED');
    assert.throws(() => assertEmailVerified({ email_confirmed_at: null }), UnverifiedEmailError);
  });

  it('accepts confirmed GoTrue timestamps', () => {
    assert.equal(isAuthEmailVerified({ email_confirmed_at: '2026-01-01T00:00:00.000Z' }), true);
    assert.equal(isAuthEmailVerified({ confirmed_at: '2026-01-01T00:00:00.000Z' }), true);
  });

  it('uses provider identity email_verified instead of assuming Google is verified', () => {
    assert.equal(
      isAuthEmailVerified({
        identities: [{ provider: 'google', identity_data: { email_verified: true } }],
      }),
      true,
    );
    assert.equal(
      isAuthEmailVerified({
        identities: [{ provider: 'google', identity_data: {} }],
      }),
      false,
    );
  });
});
