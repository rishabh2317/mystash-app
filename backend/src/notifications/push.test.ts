import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { buildMaterializeRender } from './domain/eventTypes';
import { InMemoryNotificationRepository } from './InMemoryNotificationRepository';
import { runMaterializerOnce } from './jobs/outboxMaterializer';
import { startNotificationWorker } from './jobs/startNotificationWorker';
import { NotificationService } from './NotificationService';
import { FakePushProvider } from './providers/FakePushProvider';
import { notificationPushEnabled, PushConfigError, resolvePushConfig } from './pushConfig';
import {
  InstallationConflictError,
  RevocationUnavailableError,
  type PushRegistrationInput,
  type PushRepository,
  type RegisterPushResult,
} from './PushRepository';
import { hashRevocationCredential, newRevocationCredential, PushService } from './PushService';
import {
  createRecordOpenHandler,
  createRegisterPushHandler,
  createRevokePushHandler,
  createUnregisterPushHandler,
} from './routes';
import { OUTBOX_POLICY } from './domain/policy';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INSTALL = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

/** Models the ownership rules of notification_register_push / unregister / record_push_open. */
class OwnershipPushRepo implements PushRepository {
  readonly registrations = new Map<string, { userId: string | null; token: string; hash: string | null }>();
  readonly deliveries = new Map<string, { userId: string; notificationId: string; opened: boolean }>();
  lastInput: PushRegistrationInput | null = null;
  lastHash: string | null = null;
  /** false = models a database without the revocation migration. */
  revocationSupported = true;

  async register(userId: string, input: PushRegistrationInput, revocationHash: string): Promise<RegisterPushResult> {
    this.lastInput = input;
    this.lastHash = revocationHash;
    const existing = this.registrations.get(input.installationId);
    if (existing?.userId && existing.userId !== userId && existing.token !== input.token) {
      throw new InstallationConflictError();
    }
    this.registrations.set(input.installationId, {
      userId,
      token: input.token,
      hash: this.revocationSupported ? revocationHash : null,
    });
    return {
      registrationId: '1',
      previousUserId: existing?.userId && existing.userId !== userId ? existing.userId : null,
      tokenMovedFromUserId: null,
      revocationStored: this.revocationSupported,
    };
  }
  async unregister(userId: string, installationId: string) {
    const r = this.registrations.get(installationId);
    if (!r || r.userId !== userId) return 0;
    r.userId = null;
    r.hash = null;
    return 1;
  }
  async revokeInstallation(installationId: string, revocationHash: string) {
    if (!this.revocationSupported) throw new RevocationUnavailableError();
    const r = this.registrations.get(installationId);
    if (!r || !r.userId || r.hash !== revocationHash) return false;
    r.userId = null;
    r.hash = null;
    return true;
  }
  async recordPushOpen(userId: string, notificationId: string, deliveryId: string) {
    const d = this.deliveries.get(deliveryId);
    if (!d || d.userId !== userId || d.notificationId !== notificationId) return false;
    d.opened = true;
    return true;
  }
  async claimDeliveries() {
    return null;
  }
  async beginSend() {
    return [];
  }
  async recordResults() {
    return { recorded: 0, applied: 0, duplicates: 0, ignored: 0, registrationsInvalidated: 0 };
  }
  async claimReceipts() {
    return [];
  }
  async recordReceipts() {
    return { ok: 0, errors: 0, waiting: 0, unavailable: 0, registrationsInvalidated: 0 };
  }
  async getActiveActorProfiles() {
    return [];
  }
}

type Captured = { status: number; body: unknown; headers: Record<string, string> };

function fakeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: undefined, headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
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

function fakeReq(body: unknown, params: Record<string, string>): Request {
  return { headers: { authorization: 'Bearer t' }, body, params, query: {} } as unknown as Request;
}

function setup(userId = USER) {
  const pushRepo = new OwnershipPushRepo();
  const repo = new InMemoryNotificationRepository();
  return {
    pushRepo,
    repo,
    deps: {
      service: new NotificationService(repo),
      pushService: new PushService(pushRepo),
      authenticate: async () => ({ userId }),
    },
  };
}

const validBody = { token: TOKEN, platform: 'ios', osPermission: 'granted', timezone: 'Europe/Paris', appVersion: '1.4.0' };

describe('push registration', () => {
  it('registers for the JWT user, ignoring any user id in the body', async () => {
    const { deps, pushRepo } = setup();
    const out = fakeRes();
    await createRegisterPushHandler(deps)(fakeReq({ ...validBody, userId: OTHER }, { installationId: INSTALL }), out.res);
    assert.equal(out.captured.status, 200);
    assert.equal(pushRepo.registrations.get(INSTALL)?.userId, USER);
    assert.equal((out.captured.body as { registrationId: string }).registrationId, '1');
  });

  it('validates installation id, token, platform, permission and timezone', async () => {
    const { deps, pushRepo } = setup();
    const cases: [Record<string, unknown>, string][] = [
      [validBody, 'not-a-uuid'],
      [{ ...validBody, token: 'fcm:abc' }, INSTALL],
      [{ ...validBody, platform: 'web' }, INSTALL],
      [{ ...validBody, osPermission: 'maybe' }, INSTALL],
      [{ ...validBody, provider: 'apns' }, INSTALL],
    ];
    for (const [body, installationId] of cases) {
      const out = fakeRes();
      await createRegisterPushHandler(deps)(fakeReq(body, { installationId }), out.res);
      assert.equal(out.captured.status, 400, JSON.stringify(body));
    }
    const out = fakeRes();
    await createRegisterPushHandler(deps)(fakeReq({ ...validBody, timezone: 'Mars/Olympus' }, { installationId: INSTALL }), out.res);
    assert.equal(out.captured.status, 200);
    assert.equal(pushRepo.lastInput?.timezone, null, 'an invalid timezone is dropped, not stored');
  });

  it('maps an installation takeover to 409', async () => {
    const owner = setup(USER);
    owner.pushRepo.registrations.set(INSTALL, { userId: OTHER, token: 'ExponentPushToken[other]', hash: null });
    const out = fakeRes();
    await createRegisterPushHandler(owner.deps)(fakeReq(validBody, { installationId: INSTALL }), out.res);
    assert.equal(out.captured.status, 409);
  });

  it('unregister only unlinks the caller’s own installation and is idempotent', async () => {
    const { deps, pushRepo } = setup(OTHER);
    pushRepo.registrations.set(INSTALL, { userId: USER, token: TOKEN, hash: null });
    const out = fakeRes();
    await createUnregisterPushHandler(deps)(fakeReq({}, { installationId: INSTALL }), out.res);
    assert.deepEqual(out.captured.body, { unlinked: 0 });
    assert.equal(pushRepo.registrations.get(INSTALL)?.userId, USER);
  });

  it('push opens are tracked per delivery; unknown deliveries fall back to the inbox open', async () => {
    const { deps, pushRepo, repo } = setup();
    await repo.enqueueEvent(
      {
        eventType: 'ingest.failed',
        idempotencyKey: 'ingest:open',
        recipientUserId: USER,
        actorUserId: null,
        occurredAt: new Date().toISOString(),
        payload: { ingestId: '33333333-3333-4333-8333-333333333333' },
      },
      2_592_000,
    );
    const [claimed] = await repo.claimOutbox(1, 60, 10);
    const { notificationId } = await repo.materialize(claimed.outboxId, claimed.leaseToken, buildMaterializeRender(claimed));
    pushRepo.deliveries.set('7', { userId: USER, notificationId: notificationId!, opened: false });

    const tracked = fakeRes();
    await createRecordOpenHandler(deps)(fakeReq({ deliveryId: 7 }, { id: notificationId! }), tracked.res);
    assert.equal(tracked.captured.status, 200);
    assert.equal(pushRepo.deliveries.get('7')?.opened, true);

    const fallback = fakeRes();
    await createRecordOpenHandler(deps)(fakeReq({ deliveryId: '999' }, { id: notificationId! }), fallback.res);
    assert.equal(fallback.captured.status, 200);

    const invalid = fakeRes();
    await createRecordOpenHandler(deps)(fakeReq({ deliveryId: 'abc' }, { id: notificationId! }), invalid.res);
    assert.equal(invalid.captured.status, 400);

    const phase3Client = fakeRes();
    await createRecordOpenHandler(deps)(fakeReq({}, { id: notificationId! }), phase3Client.res);
    assert.equal(phase3Client.captured.status, 200);
  });
});

describe('installation revocation credential', () => {
  async function registerAs(userId: string, installationId = INSTALL) {
    const s = setup(userId);
    const out = fakeRes();
    await createRegisterPushHandler(s.deps)(fakeReq(validBody, { installationId }), out.res);
    return { ...s, out, credential: (out.captured.body as { revocationCredential: string | null }).revocationCredential };
  }

  function revokeReq(installationId: string, credential: unknown): Request {
    return { headers: {}, body: { credential }, params: { installationId }, query: {} } as unknown as Request;
  }

  it('is returned once with no-store, and only its sha256 reaches the repository', async () => {
    const { out, credential, pushRepo } = await registerAs(USER);
    assert.match(credential ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.equal(out.captured.headers['cache-control'], 'no-store');
    assert.equal(pushRepo.lastHash, hashRevocationCredential(credential!));
    assert.notEqual(pushRepo.lastHash, credential);
    assert.ok(!JSON.stringify(pushRepo.registrations.get(INSTALL)).includes(credential!));
  });

  it('revokes its own installation without a session, once', async () => {
    const { credential, pushRepo, deps } = await registerAs(USER);
    const first = fakeRes();
    await createRevokePushHandler(deps.pushService)(revokeReq(INSTALL, credential), first.res);
    assert.deepEqual(first.captured.body, { revoked: true });
    assert.equal(pushRepo.registrations.get(INSTALL)?.userId, null);
    const again = fakeRes();
    await createRevokePushHandler(deps.pushService)(revokeReq(INSTALL, credential), again.res);
    assert.deepEqual(again.captured.body, { revoked: false });
  });

  it('cannot revoke with a wrong credential or another installation’s credential', async () => {
    const { pushRepo, deps } = await registerAs(USER);
    const otherInstall = '66666666-6666-4666-8666-666666666666';
    const other = fakeRes();
    await createRegisterPushHandler(deps)(fakeReq({ ...validBody, token: 'ExponentPushToken[other-device]' }, { installationId: otherInstall }), other.res);
    const otherCredential = (other.captured.body as { revocationCredential: string }).revocationCredential;

    const wrong = fakeRes();
    await createRevokePushHandler(deps.pushService)(revokeReq(INSTALL, 'A'.repeat(43)), wrong.res);
    assert.deepEqual(wrong.captured.body, { revoked: false });
    const crossed = fakeRes();
    await createRevokePushHandler(deps.pushService)(revokeReq(INSTALL, otherCredential), crossed.res);
    assert.deepEqual(crossed.captured.body, { revoked: false });
    assert.equal(pushRepo.registrations.get(INSTALL)?.userId, USER);
  });

  it('a previous account’s credential cannot unbind the next account on the same device', async () => {
    const first = await registerAs(USER);
    first.pushRepo.registrations.get(INSTALL)!.userId = null;
    const second = fakeRes();
    const otherDeps = { ...first.deps, authenticate: async () => ({ userId: OTHER }) };
    await createRegisterPushHandler(otherDeps)(fakeReq(validBody, { installationId: INSTALL }), second.res);
    const stale = fakeRes();
    await createRevokePushHandler(first.deps.pushService)(revokeReq(INSTALL, first.credential), stale.res);
    assert.deepEqual(stale.captured.body, { revoked: false });
    assert.equal(first.pushRepo.registrations.get(INSTALL)?.userId, OTHER);
  });

  it('validates the installation id and credential format', async () => {
    const { deps } = await registerAs(USER);
    for (const [installationId, credential] of [
      ['not-a-uuid', 'A'.repeat(43)],
      [INSTALL, 'short'],
      [INSTALL, 42],
      [INSTALL, `${'A'.repeat(42)}=`],
    ] as const) {
      const out = fakeRes();
      await createRevokePushHandler(deps.pushService)(revokeReq(installationId, credential), out.res);
      assert.equal(out.captured.status, 400, String(credential));
    }
  });

  it('before the migration: no credential is issued and revocation reports 503', async () => {
    const s = setup();
    s.pushRepo.revocationSupported = false;
    const out = fakeRes();
    await createRegisterPushHandler(s.deps)(fakeReq(validBody, { installationId: INSTALL }), out.res);
    assert.equal(out.captured.status, 200);
    assert.equal((out.captured.body as { revocationCredential: string | null }).revocationCredential, null);
    const revoke = fakeRes();
    await createRevokePushHandler(s.deps.pushService)(revokeReq(INSTALL, 'A'.repeat(43)), revoke.res);
    assert.equal(revoke.captured.status, 503);
  });

  it('credentials are random and the hash is sha256 hex', () => {
    const a = newRevocationCredential();
    assert.notEqual(a, newRevocationCredential());
    assert.match(hashRevocationCredential(a), /^[0-9a-f]{64}$/);
  });
});

describe('push configuration', () => {
  it('is disabled unless NOTIFICATIONS_PUSH_ENABLED is exactly "true"', () => {
    assert.equal(notificationPushEnabled(() => undefined), false);
    assert.equal(notificationPushEnabled((k) => (k === 'NOTIFICATIONS_PUSH_ENABLED' ? '1' : undefined)), false);
    assert.deepEqual(resolvePushConfig(() => undefined), { enabled: false });
  });

  it('fails fast when enabled without EXPO_ACCESS_TOKEN', () => {
    const env = (k: string) => (k === 'NOTIFICATIONS_PUSH_ENABLED' ? 'true' : undefined);
    assert.throws(() => resolvePushConfig(env), PushConfigError);
    const ok = resolvePushConfig((k) => ({ NOTIFICATIONS_PUSH_ENABLED: 'true', EXPO_ACCESS_TOKEN: ' tok ' })[k]);
    assert.deepEqual(ok, { enabled: true, expoAccessToken: 'tok' });
  });
});

describe('materializer push argument', () => {
  async function enqueue(repo: InMemoryNotificationRepository, key: string) {
    await repo.enqueueEvent(
      {
        eventType: 'ingest.failed',
        idempotencyKey: key,
        recipientUserId: USER,
        actorUserId: null,
        occurredAt: new Date().toISOString(),
        payload: { ingestId: '33333333-3333-4333-8333-333333333333' },
      },
      2_592_000,
    );
  }

  it('omits p_push while push is disabled (Phase 1 call shape) and sends the category policy when enabled', async () => {
    const repo = new InMemoryNotificationRepository();
    await enqueue(repo, 'ingest:a');
    await runMaterializerOnce(repo, OUTBOX_POLICY);
    const args = repo.materializePushArgs;
    assert.equal(args.length, 1);
    assert.equal(args[0], null);

    await enqueue(repo, 'ingest:b');
    await runMaterializerOnce(repo, OUTBOX_POLICY, { pushEnabled: true });
    assert.equal(args[1]?.ttl_seconds, 86_400);
    assert.equal(args[1]?.retry_policy, 'retry_ambiguous_once');
  });
});

describe('notification worker push wiring', () => {
  it('starts without push by default', async () => {
    const handle = startNotificationWorker(null, { repo: new InMemoryNotificationRepository(), push: { enabled: false } });
    assert.equal(handle.pushEnabled, false);
    assert.equal((await handle.close(2_000)).drained, true);
  });

  it('starts and drains the dispatcher and receipt poller when push is enabled', async () => {
    const provider = new FakePushProvider();
    const handle = startNotificationWorker(null, {
      repo: new InMemoryNotificationRepository(),
      push: { enabled: true, expoAccessToken: 'unused' },
      pushRepo: new OwnershipPushRepo(),
      pushProvider: provider,
    });
    assert.equal(handle.pushEnabled, true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await handle.close(2_000)).drained, true);
    assert.equal(provider.sent.length, 0);
  });
});
