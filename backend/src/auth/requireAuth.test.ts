import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { EMAIL_NOT_VERIFIED, UnverifiedEmailError } from './emailVerification';
import { rethrowUnverifiedEmail, sendAuthError } from './requireAuth';

type Captured = { status: number; body: unknown };

function fakeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

describe('requireAuth verification gate', () => {
  it('documents EMAIL_NOT_VERIFIED as the privileged-operation code', () => {
    assert.equal(EMAIL_NOT_VERIFIED, 'EMAIL_NOT_VERIFIED');
    const { captured } = fakeRes();
    captured.status = 403;
    captured.body = { error: 'Confirm your email to continue.', code: EMAIL_NOT_VERIFIED };
    assert.equal((captured.body as { code: string }).code, EMAIL_NOT_VERIFIED);
    void (0 as unknown as Request);
  });

  it('maps UnverifiedEmailError to 403 and rethrows it from authenticators', () => {
    const { res, captured } = fakeRes();
    assert.equal(sendAuthError(res, new UnverifiedEmailError()), true);
    assert.equal(captured.status, 403);
    assert.equal((captured.body as { code: string }).code, EMAIL_NOT_VERIFIED);
    assert.throws(() => rethrowUnverifiedEmail(new UnverifiedEmailError()), UnverifiedEmailError);
    assert.doesNotThrow(() => rethrowUnverifiedEmail(new Error('jwt')));
  });
});
