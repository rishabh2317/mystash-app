import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isConnectedAccountOAuthCallback,
  pickProviderAccount,
  providerStatusLabel,
  readConnectedAccountOAuthReturn,
  rewriteNativeOAuthCallbackPath,
  shouldShowConnectedProvider,
} from './connectedAccounts';
import type { ConnectedAccountsSnapshot } from '@/src/types/connectedAccounts';

describe('connectedAccounts UI helpers', () => {
  const snapshot: ConnectedAccountsSnapshot = {
    accounts: [
      {
        id: '1',
        userId: 'u',
        provider: 'youtube',
        platformAccountId: 'ch',
        displayName: 'Demo',
        username: '@demo',
        scopes: [],
        status: 'active',
        lastHealthCheckAt: null,
        lastHealthError: null,
        createdAt: '',
        updatedAt: '',
        linkingEnabled: true,
      },
    ],
    providers: {
      youtube: { linkingEnabled: true },
      instagram: { linkingEnabled: false },
    },
  };

  it('picks non-disconnected provider account', () => {
    assert.equal(pickProviderAccount(snapshot, 'youtube')?.username, '@demo');
    assert.equal(pickProviderAccount(snapshot, 'instagram'), null);
  });

  it('labels status for UI', () => {
    assert.equal(providerStatusLabel(null, false), 'Not connected');
    assert.equal(providerStatusLabel(null, true), 'Not connected');
    assert.equal(providerStatusLabel(snapshot.accounts[0]!, true), '@demo');
  });

  it('hides providers that are neither enabled nor connected', () => {
    assert.equal(shouldShowConnectedProvider(false, null), false);
    assert.equal(shouldShowConnectedProvider(true, null), true);
    assert.equal(shouldShowConnectedProvider(false, snapshot.accounts[0]!), true);
  });

  it('reads the app return hop without treating a Google code as success', () => {
    assert.deepEqual(readConnectedAccountOAuthReturn({ status: 'connected' }), { ok: true });
    assert.equal(readConnectedAccountOAuthReturn({ error: 'access_denied' }).ok, false);
    assert.equal(readConnectedAccountOAuthReturn({ code: 'auth-code', state: 's' }).ok, false);
  });

  it('keeps the native OAuth return hop out of Expo Router', () => {
    const connected = 'mystash://connected-accounts/callback?status=connected';
    const failed = 'mystash://connected-accounts/callback?status=error&error=access_denied';
    assert.equal(isConnectedAccountOAuthCallback(connected), true);
    assert.equal(isConnectedAccountOAuthCallback(failed), true);
    assert.equal(isConnectedAccountOAuthCallback('connected-accounts/callback?status=connected'), true);
    assert.equal(isConnectedAccountOAuthCallback('/connected-accounts/callback'), true);
    assert.equal(isConnectedAccountOAuthCallback('mystash://auth/callback?code=abc'), false);
    assert.equal(isConnectedAccountOAuthCallback('mystash://import?text=hi'), false);
    assert.equal(rewriteNativeOAuthCallbackPath(connected, false), null);
    assert.equal(rewriteNativeOAuthCallbackPath(failed, false), null);
    assert.equal(rewriteNativeOAuthCallbackPath(connected, true), '/settings');
    assert.equal(rewriteNativeOAuthCallbackPath('mystash://auth/callback', false), undefined);
  });
});
