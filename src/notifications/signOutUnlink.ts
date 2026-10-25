import { isInstallationId } from './pushPolicy';

/**
 * Installation-scoped revocation credential issued by the server on registration. It can only
 * unbind this installation from whichever account it is currently bound to (server stores its
 * sha256). `pending` = a sign-out could not reach the server and the unlink must be replayed.
 */
export type RevocationRecord = { installationId: string; credential: string; pending: boolean };

export type SignOutUnlinkDeps = {
  readRecord(): Promise<RevocationRecord | null>;
  writeRecord(record: RevocationRecord): Promise<void>;
  deleteRecord(): Promise<void>;
  /** Session DELETE; null when there is no session to use. */
  unlinkWithSession: ((installationId: string) => Promise<void>) | null;
  revokeWithCredential(installationId: string, credential: string): Promise<unknown>;
  /** Network failure or 5xx: the server may not have seen the request. */
  isRetryable(e: unknown): boolean;
};

export type SignOutUnlinkOutcome = 'unlinked' | 'revoked' | 'pending' | 'abandoned' | 'nothing';

const CREDENTIAL_RE = /^[A-Za-z0-9_-]{43}$/;

export function recordUsable(record: RevocationRecord | null): record is RevocationRecord {
  return Boolean(record && isInstallationId(record.installationId) && CREDENTIAL_RE.test(record.credential));
}

/** After a registration: the server rotated the secret, so any older record is now worthless. */
export async function storeIssuedCredential(
  deps: Pick<SignOutUnlinkDeps, 'writeRecord' | 'deleteRecord'>,
  installationId: string,
  credential: string | null,
): Promise<void> {
  const record = credential ? { installationId, credential, pending: false } : null;
  if (recordUsable(record)) await deps.writeRecord(record);
  else await deps.deleteRecord();
}

async function revoke(deps: SignOutUnlinkDeps, record: RevocationRecord): Promise<'revoked' | 'pending' | 'abandoned'> {
  try {
    await deps.revokeWithCredential(record.installationId, record.credential);
    await deps.deleteRecord();
    return 'revoked';
  } catch (e) {
    if (deps.isRetryable(e)) {
      await deps.writeRecord({ ...record, pending: true });
      return 'pending';
    }
    // 4xx: malformed or already-consumed credential; retrying cannot succeed.
    await deps.deleteRecord();
    return 'abandoned';
  }
}

/**
 * Before `supabase.auth.signOut()`. Session DELETE first; if the session itself is rejected,
 * fall back to the credential at once; if the network is down, keep only the credential
 * (never the session) for replay.
 */
export async function unlinkOnSignOut(deps: SignOutUnlinkDeps, installationId: string | null): Promise<SignOutUnlinkOutcome> {
  const stored = await deps.readRecord();
  const record = recordUsable(stored) && stored.installationId === installationId ? stored : null;
  if (stored && !record) await deps.deleteRecord();
  if (!installationId) return 'nothing';

  let sessionError: unknown = null;
  if (deps.unlinkWithSession) {
    try {
      await deps.unlinkWithSession(installationId);
      if (record) await deps.deleteRecord();
      return 'unlinked';
    } catch (e) {
      sessionError = e;
    }
  }
  if (!record) return 'abandoned';
  if (sessionError && deps.isRetryable(sessionError)) {
    await deps.writeRecord({ ...record, pending: true });
    return 'pending';
  }
  return revoke(deps, record);
}

/** On launch, on foreground and before any registration. */
export async function replayPendingRevocation(deps: SignOutUnlinkDeps): Promise<SignOutUnlinkOutcome> {
  const record = await deps.readRecord();
  if (!record) return 'nothing';
  if (!recordUsable(record)) {
    await deps.deleteRecord();
    return 'abandoned';
  }
  if (!record.pending) return 'nothing';
  return revoke(deps, record);
}
