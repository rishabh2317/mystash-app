import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { InMemoryNotificationRepository } from './InMemoryNotificationRepository';
import { NotificationService, NotificationServiceError } from './NotificationService';
import { buildMaterializeRender } from './domain/eventTypes';
import { engagementFactKey, ingestTerminalKey } from './domain/idempotencyKeys';
import { resolveOutboxPolicy, runMaterializerOnce } from './jobs/outboxMaterializer';
import { HEALTH_THRESHOLDS, OUTBOX_LAG_POLICY } from './domain/policy';
import { runPruneOnce, runPurgeRetryOnce, runSweepOnce } from './jobs/notificationMaintenance';

const CREATOR = '11111111-1111-4111-8111-111111111111';
const FAN_A = '22222222-2222-4222-8222-222222222222';
const FAN_B = '33333333-3333-4333-8333-333333333333';
const FAN_C = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const INGEST = '66666666-6666-4666-8666-666666666666';
const POLICY = { claimBatch: 100, leaseSeconds: 60, maxClaims: 10, concurrency: 4 };

let clock = Date.parse('2026-10-12T08:00:00.000Z');
let repo: InMemoryNotificationRepository;
let svc: NotificationService;

function at(offsetMs = 0): string {
  return new Date(clock + offsetMs).toISOString();
}

function follow(actor: string, factId: string, recipient = CREATOR) {
  return svc.emit({
    eventType: 'creator.followed',
    idempotencyKey: engagementFactKey(factId),
    recipientUserId: recipient,
    actorUserId: actor,
    occurredAt: at(),
    payload: {},
  });
}

function ingestReady(recipient = CREATOR, transitionAt = at()) {
  return svc.emit({
    eventType: 'ingest.ready_for_review',
    idempotencyKey: ingestTerminalKey(INGEST, 'ready_for_review', transitionAt),
    recipientUserId: recipient,
    actorUserId: null,
    occurredAt: transitionAt,
    payload: { ingestId: INGEST, videoTitle: 'Desk setup' },
  });
}

beforeEach(() => {
  clock = Date.parse('2026-10-12T08:00:00.000Z');
  repo = new InMemoryNotificationRepository(() => clock);
  svc = new NotificationService(repo);
  for (const [id, username, displayName] of [
    [CREATOR, 'creator', 'Creator'],
    [FAN_A, 'ana', 'Ana'],
    [FAN_B, 'ben', 'Ben'],
    [FAN_C, 'cy', null],
    [OTHER, 'other', null],
  ] as const) {
    repo.addUser(id, { username, displayName });
  }
});

describe('emit + materialize', () => {
  it('dedupes retries and rejects stale and self events', async () => {
    assert.equal(await ingestReady(), 'enqueued');
    assert.equal(await ingestReady(), 'duplicate');
    assert.equal(await ingestReady(CREATOR, at(-31 * 86_400_000)), 'stale');
    assert.equal(await follow(CREATOR, 'self'), 'self');
    await assert.rejects(
      svc.emit({
        eventType: 'creator.followed',
        idempotencyKey: 'fact:x',
        recipientUserId: CREATOR,
        actorUserId: null,
        occurredAt: at(),
        payload: {},
      }),
      NotificationServiceError,
    );
  });

  it('materializes a task notification into the feed with an allowlisted link', async () => {
    await ingestReady();
    assert.equal(await runMaterializerOnce(repo, POLICY), 1);
    const page = await svc.listFeed(CREATOR, {});
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].deepLink, `/(tabs)/create/review?ingestId=${INGEST}`);
    assert.equal((await svc.unreadCount(CREATOR)).unread, 1);
    assert.equal(page.nextCursor, null);
  });

  it('fences stale leases: a reclaimed row cannot be materialized by the old holder', async () => {
    await ingestReady();
    const [first] = await repo.claimOutbox(10, 1, 10);
    clock += 2_000;
    const [second] = await repo.claimOutbox(10, 60, 10);
    assert.notEqual(first.leaseToken, second.leaseToken);
    const render = buildMaterializeRender(first);
    assert.equal((await repo.materialize(first.outboxId, first.leaseToken, render)).outcome, 'lease_lost');
    assert.equal((await repo.materialize(second.outboxId, second.leaseToken, render)).outcome, 'created');
    assert.equal((await repo.materialize(second.outboxId, second.leaseToken, render)).outcome, 'lease_lost');
    assert.equal(repo.notifications.size, 1);
  });

  it('dead-letters invalid payloads without retrying', async () => {
    await repo.enqueueEvent(
      {
        eventType: 'ingest.failed',
        idempotencyKey: 'ingest:bad',
        recipientUserId: CREATOR,
        actorUserId: null,
        occurredAt: at(),
        payload: {},
      },
      2_592_000,
    );
    await runMaterializerOnce(repo, POLICY);
    const row = [...repo.outbox.values()][0];
    assert.equal(row.status, 'dead');
    assert.match(row.lastError ?? '', /invalid_payload/);
  });
});

describe('aggregation', () => {
  it('collapses a bucket into one row; repeats by the same actor do not resurface it', async () => {
    await follow(FAN_A, 'f1');
    await follow(FAN_B, 'f2');
    await runMaterializerOnce(repo, POLICY);
    let [row] = [...repo.notifications.values()];
    assert.equal(repo.notifications.size, 1);
    assert.equal(row.actorCount, 2);
    assert.equal(row.eventCount, 2);

    await svc.markRead(CREATOR, { all: true });
    await follow(FAN_A, 'f3');
    await runMaterializerOnce(repo, POLICY);
    [row] = [...repo.notifications.values()];
    assert.equal(row.eventCount, 3);
    assert.equal(row.actorCount, 2);
    assert.notEqual(row.readAt, null, 'same actor again stays read');

    await follow(FAN_C, 'f4');
    await runMaterializerOnce(repo, POLICY);
    [row] = [...repo.notifications.values()];
    assert.equal(row.actorCount, 3);
    assert.equal(row.readAt, null, 'new actor resurfaces');

    const page = await svc.listFeed(CREATOR, {});
    assert.equal(page.items[0].body, 'Ana and 2 others followed you.');
  });

  it('starts a new row in the next bucket', async () => {
    await follow(FAN_A, 'f1');
    await runMaterializerOnce(repo, POLICY);
    clock += 3_600_000;
    await follow(FAN_B, 'f2');
    await runMaterializerOnce(repo, POLICY);
    assert.equal(repo.notifications.size, 2);
  });

  it('suppresses events from suspended actors', async () => {
    repo.addUser(FAN_A, { accountStatus: 'SUSPENDED' });
    await follow(FAN_A, 'f1');
    await runMaterializerOnce(repo, POLICY);
    assert.equal(repo.notifications.size, 0);
    assert.equal([...repo.outbox.values()][0].result, 'suppressed_actor_unavailable');
  });
});

describe('channel preferences', () => {
  it('stores no row when the only available channel (inbox) is off', async () => {
    repo.setPreference(CREATOR, 'social', 'inbox', false);
    await follow(FAN_A, 'f1');
    await runMaterializerOnce(repo, POLICY);
    assert.equal(repo.notifications.size, 0);
    assert.equal([...repo.outbox.values()][0].result, 'suppressed_preference');
  });

  it('keeps task inbox always on and rejects storing it', async () => {
    assert.throws(() => repo.setPreference(CREATOR, 'task', 'inbox', false));
    repo.setPreference(CREATOR, 'task', 'push', false);
    await ingestReady();
    await runMaterializerOnce(repo, POLICY);
    assert.equal((await svc.listFeed(CREATOR, {})).items.length, 1);
  });

  it('delivers task notifications to CREATED users and skips suspended recipients', async () => {
    repo.addUser(CREATOR, { accountStatus: 'CREATED' });
    repo.addUser(OTHER, { accountStatus: 'SUSPENDED' });
    await ingestReady(CREATOR);
    await ingestReady(OTHER);
    await runMaterializerOnce(repo, POLICY);
    assert.equal((await svc.listFeed(CREATOR, {})).items.length, 1);
    assert.equal((await svc.listFeed(OTHER, {})).items.length, 0);
  });
});

describe('inbox ownership', () => {
  it('never exposes or mutates another user’s notifications', async () => {
    await ingestReady();
    await runMaterializerOnce(repo, POLICY);
    const [item] = (await svc.listFeed(CREATOR, {})).items;
    assert.equal((await svc.listFeed(OTHER, {})).items.length, 0);
    await assert.rejects(svc.recordOpen(OTHER, item.id), (e: NotificationServiceError) => e.statusCode === 404);
    assert.equal((await svc.markRead(OTHER, { ids: [item.id] })).updated, 0);
    await svc.recordOpen(CREATOR, item.id);
    assert.equal((await svc.unreadCount(CREATOR)).unread, 0);
  });

  it('paginates by cursor and validates inputs', async () => {
    for (let i = 0; i < 3; i += 1) {
      clock += 1_000;
      await ingestReady(CREATOR, at());
    }
    await runMaterializerOnce(repo, POLICY);
    const first = await svc.listFeed(CREATOR, { limit: 2 });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = await svc.listFeed(CREATOR, { limit: 2, cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.ok(!first.items.some((i) => i.id === second.items[0].id));

    clock += 1_000;
    await ingestReady(CREATOR, at());
    await runMaterializerOnce(repo, POLICY);
    assert.equal((await svc.markSeen(CREATOR, first.headCursor)).updated, 3);
    assert.equal((await svc.markRead(CREATOR, { all: true, before: first.headCursor })).updated, 3);
    assert.equal((await svc.unreadCount(CREATOR)).unread, 1, 'a newer item stays unread');
    await assert.rejects(svc.listFeed(CREATOR, { cursor: 'bad' }), NotificationServiceError);
    await assert.rejects(svc.listFeed(CREATOR, { category: 'spam' }), NotificationServiceError);
    await assert.rejects(svc.markRead(CREATOR, {}), NotificationServiceError);
    await assert.rejects(svc.markRead(CREATOR, { ids: ['not-a-uuid'] }), NotificationServiceError);
  });
});

describe('account deletion purge', () => {
  it('recomputes aggregates without the deleted actor and deletes zero-actor rows', async () => {
    await follow(FAN_A, 'f1');
    await follow(FAN_B, 'f2');
    await runMaterializerOnce(repo, POLICY);

    await svc.purgeUser(FAN_A);
    let [row] = [...repo.notifications.values()];
    assert.equal(row.actorCount, 1);
    assert.deepEqual(row.sampleActorIds, [FAN_B]);
    assert.equal(row.lastActorUserId, FAN_B);

    await svc.purgeUser(FAN_B);
    assert.equal(repo.notifications.size, 0);
    assert.equal((await svc.purgeUser(FAN_B)).done, true, 'idempotent');
  });

  it('deletes the recipient’s inbox, outbox and preferences but keeps dedupe keys', async () => {
    repo.setPreference(CREATOR, 'social', 'push', false);
    await ingestReady();
    await runMaterializerOnce(repo, POLICY);
    await ingestReady(CREATOR, at(1));
    await svc.purgeUser(CREATOR);
    assert.equal(repo.notifications.size, 0);
    assert.equal([...repo.outbox.values()].filter((o) => o.recipientUserId === CREATOR).length, 0);
    assert.equal(repo.preferences.size, 0);
    assert.equal(repo.eventKeys.size, 2);
    assert.equal(await ingestReady(), 'duplicate', 'replay after purge stays deduplicated');
  });

  it('clears the actor on pending outbox rows so they are suppressed', async () => {
    await follow(FAN_A, 'f1');
    await svc.purgeUser(FAN_A);
    await runMaterializerOnce(repo, POLICY);
    assert.equal([...repo.outbox.values()][0].result, 'suppressed_actor_unavailable');
  });

  it('retries purges for recently soft-deleted accounts', async () => {
    await follow(FAN_A, 'f1');
    await runMaterializerOnce(repo, POLICY);
    repo.addUser(FAN_A, { accountStatus: 'DELETED', deletedAt: at() });
    assert.equal(await runPurgeRetryOnce(repo, svc, () => clock), 1);
    assert.equal(repo.notifications.size, 0);
  });
});

describe('maintenance', () => {
  it('dead-letters rows that exhaust the claim limit', async () => {
    await ingestReady();
    for (let i = 0; i < 10; i += 1) {
      await repo.claimOutbox(10, 0, 10);
      clock += 1;
    }
    assert.equal((await repo.claimOutbox(10, 0, 10)).length, 0);
    assert.equal(await runSweepOnce(repo), 1);
    assert.equal([...repo.outbox.values()][0].status, 'dead');
  });

  it('prunes by retention without re-admitting old events', async () => {
    await ingestReady();
    await runMaterializerOnce(repo, POLICY);
    clock += 121 * 86_400_000;
    await runPruneOnce(repo);
    assert.equal(repo.outbox.size, 0);
    assert.equal(repo.eventKeys.size, 0);
    assert.equal(repo.notifications.size, 0);
    assert.equal(await ingestReady(CREATOR, new Date(Date.parse('2026-10-12T08:00:00.000Z')).toISOString()), 'stale');
  });

  it('refuses to prune keys that are younger than the stale cutoff', async () => {
    await assert.rejects(
      repo.prune({
        batch: 10,
        outboxProcessedDays: 7,
        outboxDeadDays: 30,
        eventKeyDays: 30,
        staleAfterDays: 30,
        inboxDays: 90,
      }),
    );
  });
});

describe('campaign fan-out', () => {
  it('fans out promo.broadcast in batches and is idempotent on replay', async () => {
    const campaign = await svc.createCampaign({
      name: 'spring',
      title: 'Something new',
      body: 'Open Mystash.',
      deepLink: '/notifications',
      audience: 'all_active',
      occurredAt: at(),
    });
    const first = await svc.fanOutCampaign(campaign.id, 2);
    assert.equal(first.fannedOut, 2);
    assert.equal(first.done, false);
    const rest = await svc.fanOutDueCampaigns(5);
    assert.equal(rest, 3);
    const replay = await svc.fanOutCampaign(campaign.id, 5);
    assert.equal(replay.fannedOut, 0);
    assert.equal(replay.done, true);
    while ((await runMaterializerOnce(repo, POLICY)) > 0) {
      /* drain */
    }
    const feed = await svc.listFeed(CREATOR, { limit: 20, category: 'promo' });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0]?.type, 'promo.broadcast');
  });

  it('promo_push_opt_in fans out only after opt-in', async () => {
    const empty = await svc.createCampaign({
      name: 'opt',
      title: 'Offers',
      body: 'News you opted into.',
      deepLink: '/notifications',
      audience: 'promo_push_opt_in',
      occurredAt: at(),
    });
    const none = await svc.fanOutCampaign(empty.id, 50);
    assert.equal(none.fannedOut, 0);
    assert.equal(none.done, true);
    await svc.updateSettings(FAN_A, { preferences: [{ category: 'promo', channel: 'push', enabled: true }] });
    const opted = await svc.createCampaign({
      name: 'opt2',
      title: 'Offers',
      body: 'News you opted into.',
      deepLink: '/notifications',
      audience: 'promo_push_opt_in',
      occurredAt: at(),
    });
    const result = await svc.fanOutCampaign(opted.id, 50);
    assert.equal(result.fannedOut, 1);
    assert.equal(result.done, true);
  });

  it('rejects a deep link that is not allowlisted', async () => {
    await assert.rejects(
      () =>
        svc.createCampaign({
          name: 'bad',
          title: 'x',
          body: 'y',
          deepLink: 'https://evil.example',
          audience: 'all_active',
        }),
      /allowlisted/,
    );
  });
});

describe('outbox lag boost', () => {
  it('uses the lag policy and batch RPC once due outbox is older than the SLO', async () => {
    await ingestReady();
    clock += (HEALTH_THRESHOLDS.outboxLagSeconds + 1) * 1000;
    const resolved = await resolveOutboxPolicy(repo, () => clock);
    assert.equal(resolved.batchRpc, true);
    assert.equal(resolved.policy.claimBatch, OUTBOX_LAG_POLICY.claimBatch);
    assert.equal(await runMaterializerOnce(repo, resolved.policy, { batchRpc: true }), 1);
    const feed = await svc.listFeed(CREATOR, { limit: 5 });
    assert.equal(feed.items[0]?.type, 'ingest.ready_for_review');
  });
});

describe('notification settings', () => {
  it('defaults every configurable pair on except promo push, and accepts quiet hours', async () => {
    const local = new InMemoryNotificationRepository();
    const settingsSvc = new NotificationService(local);
    const defaults = await settingsSvc.getSettings(CREATOR);
    assert.equal(defaults.timezone, 'UTC');
    assert.equal(defaults.quietHours, null);
    assert.equal(defaults.promoOptedIn, false);
    const promoPush = defaults.preferences.find((p) => p.category === 'promo' && p.channel === 'push');
    const socialInbox = defaults.preferences.find((p) => p.category === 'social' && p.channel === 'inbox');
    assert.equal(promoPush?.enabled, false);
    assert.equal(socialInbox?.enabled, true);

    const saved = await settingsSvc.updateSettings(CREATOR, {
      preferences: [{ category: 'social', channel: 'push', enabled: false }],
      timezone: 'America/Los_Angeles',
      quietHours: { start: '22:00', end: '07:00' },
    });
    assert.equal(saved.timezone, 'America/Los_Angeles');
    assert.deepEqual(saved.quietHours, { start: '22:00:00', end: '07:00:00' });
    assert.equal(saved.preferences.find((p) => p.category === 'social' && p.channel === 'push')?.enabled, false);
    assert.equal(saved.preferences.find((p) => p.category === 'task' && p.channel === 'push')?.enabled, true);
  });

  it('rejects non-configurable pairs and records promo opt-in when promo push is turned on', async () => {
    const local = new InMemoryNotificationRepository();
    const settingsSvc = new NotificationService(local);
    await assert.rejects(
      () => settingsSvc.updateSettings(CREATOR, { preferences: [{ category: 'task', channel: 'inbox', enabled: false }] }),
      /cannot be changed/,
    );
    await assert.rejects(
      () => settingsSvc.updateSettings(CREATOR, { timezone: 'Not/A_Zone' }),
      /time zone/,
    );
    const opted = await settingsSvc.updateSettings(CREATOR, {
      preferences: [{ category: 'promo', channel: 'push', enabled: true }],
    });
    assert.equal(opted.promoOptedIn, true);
    const off = await settingsSvc.updateSettings(CREATOR, {
      preferences: [{ category: 'promo', channel: 'push', enabled: false }],
    });
    assert.equal(off.promoOptedIn, true);
    assert.equal(off.preferences.find((p) => p.category === 'promo' && p.channel === 'push')?.enabled, false);
  });
});
