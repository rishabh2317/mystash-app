import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { shouldRedirectToPasswordReset } from './recoveryRedirect';

const ROOT = process.cwd();

describe('password recovery routing', () => {
  it('sends recovery sessions to reset-password except callback and the reset screen', () => {
    assert.equal(
      shouldRedirectToPasswordReset({
        loading: false,
        hasSession: true,
        passwordRecoveryPending: true,
        pathname: '/(tabs)/profile',
      }),
      true,
    );
    assert.equal(
      shouldRedirectToPasswordReset({
        loading: false,
        hasSession: true,
        passwordRecoveryPending: true,
        pathname: '/auth/callback',
      }),
      false,
    );
    assert.equal(
      shouldRedirectToPasswordReset({
        loading: false,
        hasSession: true,
        passwordRecoveryPending: true,
        pathname: '/auth/reset-password',
      }),
      false,
    );
    assert.equal(
      shouldRedirectToPasswordReset({
        loading: false,
        hasSession: true,
        passwordRecoveryPending: false,
        pathname: '/(tabs)/profile',
      }),
      false,
    );
  });

  it('listens for PASSWORD_RECOVERY and mounts a root recovery gate', () => {
    const auth = readFileSync(join(ROOT, 'contexts/AuthContext.tsx'), 'utf8');
    assert.match(auth, /PASSWORD_RECOVERY/);
    assert.match(auth, /updatePassword[\s\S]*writePasswordRecoveryPending\(AsyncStorage, false\)/);
    const layout = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
    assert.match(layout, /AuthRecoveryGate/);
  });
});
