import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { InMemoryNotificationRepository } from './InMemoryNotificationRepository';
import { NotificationService } from './NotificationService';
import {
  createCreateCampaignHandler,
  createGetCampaignHandler,
  createGetNotificationSettingsHandler,
  createListNotificationsHandler,
  createMarkReadHandler,
  createNotificationHealthHandler,
  createRecordOpenHandler,
  createUnreadCountHandler,
  createUpdateNotificationSettingsHandler,
} from './routes';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

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

function fakeReq(opts: {
  authorization?: string | null;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.authorization !== null) headers.authorization = opts.authorization ?? 'Bearer token';
  return {
    headers,
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
  } as unknown as Request;
}

function deps(userId: string | null = USER) {
  const repo = new InMemoryNotificationRepository();
  return {
    repo,
    service: new NotificationService(repo),
    authenticate: async () => (userId ? { userId } : null),
  };
}

describe('notification routes', () => {
  it('rejects unverified email sessions on write routes', async () => {
    const { UnverifiedEmailError } = await import('../auth/emailVerification');
    const d = {
      ...deps(),
      authenticate: async () => {
        throw new UnverifiedEmailError();
      },
    };
    const { res, captured } = fakeRes();
    await createMarkReadHandler(d)(fakeReq({ body: { ids: [] } }), res);
    assert.equal(captured.status, 403);
    assert.equal((captured.body as { code?: string }).code, 'EMAIL_NOT_VERIFIED');
  });

  it('requires a bearer token and a verified user', async () => {
    const d = deps(null);
    const missing = fakeRes();
    await createUnreadCountHandler(d)(fakeReq({ authorization: null }), missing.res);
    assert.equal(missing.captured.status, 401);
    const invalid = fakeRes();
    await createUnreadCountHandler(d)(fakeReq({}), invalid.res);
    assert.equal(invalid.captured.status, 401);
  });

  it('returns 404 for notifications owned by someone else', async () => {
    const d = deps(OTHER);
    await d.repo.enqueueEvent(
      {
        eventType: 'ingest.failed',
        idempotencyKey: 'ingest:1',
        recipientUserId: USER,
        actorUserId: null,
        occurredAt: new Date().toISOString(),
        payload: { ingestId: '33333333-3333-4333-8333-333333333333' },
      },
      2_592_000,
    );
    const [claimed] = await d.repo.claimOutbox(1, 60, 10);
    const { buildMaterializeRender } = await import('./domain/eventTypes');
    const { notificationId } = await d.repo.materialize(
      claimed.outboxId,
      claimed.leaseToken,
      buildMaterializeRender(claimed),
    );
    const { res, captured } = fakeRes();
    await createRecordOpenHandler(d)(fakeReq({ params: { id: notificationId as string } }), res);
    assert.equal(captured.status, 404);
  });

  it('maps validation errors to 400 and serves the feed shape', async () => {
    const d = deps();
    const bad = fakeRes();
    await createMarkReadHandler(d)(fakeReq({ body: { ids: 'nope' } }), bad.res);
    assert.equal(bad.captured.status, 400);
    const feed = fakeRes();
    await createListNotificationsHandler(d)(fakeReq({ query: { limit: '5' } }), feed.res);
    assert.equal(feed.captured.status, 200);
    assert.deepEqual(feed.captured.body, { items: [], nextCursor: null, headCursor: null });
  });

  it('hides the internal health endpoint unless the secret matches', async () => {
    const d = deps();
    const previous = process.env.NOTIFICATIONS_HEALTH_SECRET;
    process.env.NOTIFICATIONS_HEALTH_SECRET = 's3cret';
    try {
      const denied = fakeRes();
      await createNotificationHealthHandler(d.repo)(fakeReq({ headers: { 'x-notifications-health-secret': 'x' } }), denied.res);
      assert.equal(denied.captured.status, 404);
      const ok = fakeRes();
      await createNotificationHealthHandler(d.repo)(
        fakeReq({ headers: { 'x-notifications-health-secret': 's3cret' } }),
        ok.res,
      );
      assert.equal(ok.captured.status, 200);
      assert.equal((ok.captured.body as { status: string }).status, 'ok');
    } finally {
      if (previous === undefined) delete process.env.NOTIFICATIONS_HEALTH_SECRET;
      else process.env.NOTIFICATIONS_HEALTH_SECRET = previous;
    }
  });

  it('reads and writes notification settings for the verified user only', async () => {
    const d = deps();
    const get = fakeRes();
    await createGetNotificationSettingsHandler(d)(fakeReq({}), get.res);
    assert.equal(get.captured.status, 200);
    const put = fakeRes();
    await createUpdateNotificationSettingsHandler(d)(
      fakeReq({
        body: {
          quietHours: { start: '21:30', end: '06:00' },
          timezone: 'Europe/London',
          preferences: [{ category: 'social', channel: 'inbox', enabled: false }],
        },
      }),
      put.res,
    );
    const body = put.captured.body as { timezone: string; quietHours: { start: string } };
    assert.equal(body.timezone, 'Europe/London');
    assert.equal(body.quietHours.start, '21:30:00');
    const bad = fakeRes();
    await createUpdateNotificationSettingsHandler(d)(
      fakeReq({ body: { preferences: [{ category: 'security', channel: 'push', enabled: false }] } }),
      bad.res,
    );
    assert.equal(bad.captured.status, 400);
  });

  it('hides campaign operator routes unless the secret matches', async () => {
    const d = deps();
    d.repo.addUser(USER);
    const previous = process.env.NOTIFICATIONS_OPERATOR_SECRET;
    process.env.NOTIFICATIONS_OPERATOR_SECRET = 'op-secret';
    try {
      const denied = fakeRes();
      await createCreateCampaignHandler(d)(fakeReq({ headers: { 'x-notifications-operator-secret': 'nope' } }), denied.res);
      assert.equal(denied.captured.status, 404);
      const created = fakeRes();
      await createCreateCampaignHandler(d)(
        fakeReq({
          headers: { 'x-notifications-operator-secret': 'op-secret' },
          body: {
            name: 'spring',
            title: 'Something new',
            body: 'Open Mystash.',
            deepLink: '/notifications',
            audience: 'all_active',
          },
        }),
        created.res,
      );
      assert.equal(created.captured.status, 201);
      const id = (created.captured.body as { id: string }).id;
      const got = fakeRes();
      await createGetCampaignHandler(d)(
        fakeReq({ headers: { 'x-notifications-operator-secret': 'op-secret' }, params: { id } }),
        got.res,
      );
      assert.equal(got.captured.status, 200);
      assert.equal((got.captured.body as { name: string }).name, 'spring');
    } finally {
      if (previous === undefined) delete process.env.NOTIFICATIONS_OPERATOR_SECRET;
      else process.env.NOTIFICATIONS_OPERATOR_SECRET = previous;
    }
  });
});
