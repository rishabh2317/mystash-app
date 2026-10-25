import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  replayPendingRevocation,
  storeIssuedCredential,
  unlinkOnSignOut,
  type RevocationRecord,
  type SignOutUnlinkDeps,
} from './signOutUnlink';

const INSTALL = '55555555-5555-4555-8555-555555555555';
const OTHER_INSTALL = '66666666-6666-4666-8666-666666666666';
const CRED = 'a'.repeat(43);
const OTHER_CRED = 'b'.repeat(43);

class HttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`http ${statusCode}`);
  }
}

/** Fake server modelling the credential rules: one hash per installation, single use, scoped. */
class World {
  online = true;
  sessionValid = true;
  readonly bound = new Map<string, string | null>([[INSTALL, 'user-a']]);
  readonly hashes = new Map<string, string | null>([[INSTALL, CRED]]);
  stored: RevocationRecord | null = null;
  readonly calls: string[] = [];

  deps(withSession = true): SignOutUnlinkDeps {
    return {
      readRecord: async () => this.stored,
      writeRecord: async (r) => {
        this.stored = r;
      },
      deleteRecord: async () => {
        this.stored = null;
      },
      unlinkWithSession: withSession
        ? async (id) => {
            this.calls.push(`delete:${id}`);
            if (!this.online) throw new TypeError('Network request failed');
            if (!this.sessionValid) throw new HttpError(401);
            this.bound.set(id, null);
            this.hashes.set(id, null);
          }
        : null,
      revokeWithCredential: async (id, credential) => {
        this.calls.push(`revoke:${id}`);
        if (!this.online) throw new TypeError('Network request failed');
        const ok = this.bound.get(id) != null && this.hashes.get(id) === credential;
        if (ok) {
          this.bound.set(id, null);
          this.hashes.set(id, null);
        }
        return { revoked: ok };
      },
      isRetryable: (e) => !(e instanceof HttpError) || e.statusCode >= 500,
    };
  }
}

function signedIn(): World {
  const w = new World();
  w.stored = { installationId: INSTALL, credential: CRED, pending: false };
  return w;
}

describe('sign-out unlink', () => {
  it('online: session DELETE unlinks and the credential is deleted', async () => {
    const w = signedIn();
    assert.equal(await unlinkOnSignOut(w.deps(), INSTALL), 'unlinked');
    assert.equal(w.bound.get(INSTALL), null);
    assert.equal(w.stored, null);
    assert.deepEqual(w.calls, [`delete:${INSTALL}`]);
  });

  it('online with a rejected session: falls back to the credential immediately', async () => {
    const w = signedIn();
    w.sessionValid = false;
    assert.equal(await unlinkOnSignOut(w.deps(), INSTALL), 'revoked');
    assert.equal(w.bound.get(INSTALL), null);
    assert.equal(w.stored, null);
  });

  it('offline: keeps only the installation credential, marked pending', async () => {
    const w = signedIn();
    w.online = false;
    assert.equal(await unlinkOnSignOut(w.deps(), INSTALL), 'pending');
    assert.deepEqual(w.stored, { installationId: INSTALL, credential: CRED, pending: true });
    assert.deepEqual(Object.keys(w.stored ?? {}).sort(), ['credential', 'installationId', 'pending']);
    assert.equal(w.bound.get(INSTALL), 'user-a');
  });

  it('retry: replay stays pending while offline, then revokes and deletes once connectivity returns', async () => {
    const w = signedIn();
    w.online = false;
    await unlinkOnSignOut(w.deps(), INSTALL);
    assert.equal(await replayPendingRevocation(w.deps(false)), 'pending');
    assert.equal(w.stored?.pending, true);

    w.online = true;
    assert.equal(await replayPendingRevocation(w.deps(false)), 'revoked');
    assert.equal(w.bound.get(INSTALL), null);
    assert.equal(w.stored, null);
    assert.equal(await replayPendingRevocation(w.deps(false)), 'nothing');
  });

  it('replay ignores a record that is not pending (still signed in)', async () => {
    const w = signedIn();
    assert.equal(await replayPendingRevocation(w.deps()), 'nothing');
    assert.equal(w.bound.get(INSTALL), 'user-a');
    assert.deepEqual(w.calls, []);
  });

  it('a non-retryable rejection drops the record instead of retrying forever', async () => {
    const w = signedIn();
    w.stored = { installationId: INSTALL, credential: CRED, pending: true };
    const deps = { ...w.deps(false), revokeWithCredential: async () => Promise.reject(new HttpError(400)) };
    assert.equal(await replayPendingRevocation(deps), 'abandoned');
    assert.equal(w.stored, null);
  });

  it('no session and no credential: nothing to send, local cleanup still runs (caller)', async () => {
    const w = new World();
    assert.equal(await unlinkOnSignOut(w.deps(false), INSTALL), 'abandoned');
    assert.deepEqual(w.calls, []);
  });
});

describe('unauthorized revocation is prevented', () => {
  it('a credential for another installation is never sent for this one', async () => {
    const w = signedIn();
    w.stored = { installationId: OTHER_INSTALL, credential: OTHER_CRED, pending: false };
    w.online = false;
    assert.equal(await unlinkOnSignOut(w.deps(), INSTALL), 'abandoned');
    assert.equal(w.stored, null);
  });

  it('a stale credential from a previous account cannot unbind the next account', async () => {
    const w = signedIn();
    w.online = false;
    await unlinkOnSignOut(w.deps(), INSTALL);
    const stale = w.stored;
    // Account B registers the same installation; the server rotates the secret.
    w.online = true;
    w.bound.set(INSTALL, 'user-b');
    w.hashes.set(INSTALL, OTHER_CRED);
    await storeIssuedCredential(w.deps(), INSTALL, OTHER_CRED);
    assert.equal(w.stored?.credential, OTHER_CRED);
    assert.equal(w.stored?.pending, false);

    w.stored = stale;
    assert.equal(await replayPendingRevocation(w.deps(false)), 'revoked');
    assert.equal(w.bound.get(INSTALL), 'user-b', 'server rejects the stale secret');
    assert.equal(w.stored, null);
  });

  it('malformed records are discarded without a network call', async () => {
    const w = new World();
    w.stored = { installationId: 'not-a-uuid', credential: CRED, pending: true };
    assert.equal(await replayPendingRevocation(w.deps(false)), 'abandoned');
    w.stored = { installationId: INSTALL, credential: 'short', pending: true };
    assert.equal(await replayPendingRevocation(w.deps(false)), 'abandoned');
    assert.deepEqual(w.calls, []);
  });

  it('a server without the migration issues no credential, so nothing is retained', async () => {
    const w = signedIn();
    await storeIssuedCredential(w.deps(), INSTALL, null);
    assert.equal(w.stored, null);
  });
});
