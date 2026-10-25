import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { InMemoryNotificationRepository } from './InMemoryNotificationRepository';
import { NotificationService } from './NotificationService';
import { buildMaterializeRender, NOTIFICATION_TYPES } from './domain/eventTypes';
import { isAllowedDeepLink } from './domain/deepLinks';
import { runMaterializerOnce } from './jobs/outboxMaterializer';
import {
  NOOP_NOTIFICATION_EMITTER,
  collectionSavedEvent,
  creatorFollowedEvent,
  creatorStatusEvent,
  getNotificationEmitter,
  ingestFailedEvent,
  ingestReadyEvent,
  librarySyncFailedEvent,
  needsReauthEvent,
  publishFailedEvent,
  publishSucceededEvent,
  reelLikedEvent,
} from './producers';
import type { EnqueueEventInput } from './domain/types';

const USER = '11111111-1111-4111-8111-111111111111';
const ACTOR = '55555555-5555-4555-8555-555555555555';
const INGEST = '22222222-2222-4222-8222-222222222222';
const COLLECTION = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const FACT = '66666666-6666-4666-8666-666666666666';
const AT = '2026-10-12T08:00:00.123Z';

function render(event: EnqueueEventInput) {
  return buildMaterializeRender({
    eventType: event.eventType,
    recipientUserId: event.recipientUserId,
    payload: event.payload,
  });
}

const ALL_EVENTS: EnqueueEventInput[] = [
  ingestReadyEvent({ ingestId: INGEST, userId: USER, transitionAt: AT, productCount: 3, videoTitle: 'Desk tour' }),
  ingestFailedEvent({ ingestId: INGEST, userId: USER, transitionAt: AT }),
  publishSucceededEvent({ collectionId: COLLECTION, userId: USER, publishedAt: AT, collectionTitle: 'Desk' }),
  publishFailedEvent({ ingestId: INGEST, userId: USER, failedAt: AT, collectionId: null }),
  librarySyncFailedEvent({
    connectedAccountId: ACCOUNT,
    userId: USER,
    runStartedAt: AT,
    failedAt: AT,
    provider: 'youtube',
  }),
  needsReauthEvent({ connectedAccountId: ACCOUNT, userId: USER, transitionAt: AT, provider: 'youtube' }),
  creatorStatusEvent({ userId: USER, from: 'ACTIVE', to: 'SUSPENDED', changedAt: AT }),
];

describe('task and account producers', () => {
  afterEach(() => {
    delete process.env.NOTIFICATIONS_PRODUCERS_ENABLED;
  });

  for (const event of ALL_EVENTS) {
    it(`${event.eventType} uses the source timestamp and renders an allowlisted link`, () => {
      assert.equal(event.occurredAt, AT);
      assert.equal(event.actorUserId, null);
      assert.ok(event.idempotencyKey.length <= 200);
      const r = render(event);
      assert.ok(isAllowedDeepLink(r.deep_link), r.deep_link);
      assert.equal(r.group_key, null);
    });
  }

  it('derives distinct keys per source transition and identical keys on replay', () => {
    const a = ingestReadyEvent({ ingestId: INGEST, userId: USER, transitionAt: AT, productCount: 1 });
    const replay = ingestReadyEvent({ ingestId: INGEST, userId: USER, transitionAt: AT, productCount: 1 });
    const later = ingestReadyEvent({
      ingestId: INGEST,
      userId: USER,
      transitionAt: '2026-10-12T09:00:00.000Z',
      productCount: 1,
    });
    assert.equal(a.idempotencyKey, replay.idempotencyKey);
    assert.notEqual(a.idempotencyKey, later.idempotencyKey);
    assert.notEqual(
      ingestReadyEvent({ ingestId: INGEST, userId: USER, transitionAt: AT, productCount: 1 }).idempotencyKey,
      ingestFailedEvent({ ingestId: INGEST, userId: USER, transitionAt: AT }).idempotencyKey,
    );
  });

  it('keys library sync failures on the run, not the failure time', () => {
    const base = { connectedAccountId: ACCOUNT, userId: USER, runStartedAt: AT, provider: 'youtube' };
    assert.equal(
      librarySyncFailedEvent({ ...base, failedAt: AT }).idempotencyKey,
      librarySyncFailedEvent({ ...base, failedAt: '2026-10-12T10:00:00.000Z' }).idempotencyKey,
    );
  });

  it('uses empty-draft copy when no products were found', () => {
    const r = render(ingestReadyEvent({ ingestId: INGEST, userId: USER, transitionAt: AT, productCount: 0 }));
    assert.equal(r.title, 'Your draft is ready');
    assert.equal(r.deep_link, `/(tabs)/create/review?ingestId=${INGEST}`);
  });

  it('links publish failures to the draft even before a Collection exists', () => {
    const r = render(publishFailedEvent({ ingestId: INGEST, userId: USER, failedAt: AT }));
    assert.equal(r.deep_link, `/(tabs)/create/review?ingestId=${INGEST}`);
  });

  it('distinguishes reinstatement from first activation', () => {
    const restored = render(creatorStatusEvent({ userId: USER, from: 'SUSPENDED', to: 'ACTIVE', changedAt: AT }));
    assert.equal(restored.body, 'Your creator access has been restored.');
    const paused = render(creatorStatusEvent({ userId: USER, from: 'ACTIVE', to: 'SUSPENDED', changedAt: AT }));
    assert.match(paused.body, /paused/);
  });

  it('flows end to end into the inbox and dedupes a replayed transition', async () => {
    const repo = new InMemoryNotificationRepository();
    const svc = new NotificationService(repo);
    const now = new Date().toISOString();
    const event = ingestFailedEvent({ ingestId: INGEST, userId: USER, transitionAt: now });
    assert.equal(await svc.emitSafely(event), 'enqueued');
    assert.equal(await svc.emitSafely(event), 'duplicate');
    await runMaterializerOnce(repo);
    const page = await svc.listFeed(USER, {});
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].category, 'task');
  });

  it('can be switched off without touching producers', () => {
    process.env.NOTIFICATIONS_PRODUCERS_ENABLED = 'false';
    assert.equal(getNotificationEmitter(), NOOP_NOTIFICATION_EMITTER);
  });
});

describe('social producers', () => {
  it('keys on the engagement fact and requires an actor', () => {
    const follow = creatorFollowedEvent({
      factEventId: FACT,
      recipientUserId: USER,
      actorUserId: ACTOR,
      occurredAt: AT,
    });
    assert.equal(follow.idempotencyKey, `fact:${FACT}`);
    assert.equal(follow.occurredAt, AT);
    assert.equal(follow.actorUserId, ACTOR);
    assert.ok(NOTIFICATION_TYPES[follow.eventType].requiresActor);
    const save = collectionSavedEvent({
      factEventId: FACT,
      recipientUserId: USER,
      actorUserId: ACTOR,
      occurredAt: AT,
      collectionId: COLLECTION,
    });
    const like = reelLikedEvent({
      factEventId: FACT,
      recipientUserId: USER,
      actorUserId: ACTOR,
      occurredAt: AT,
      collectionId: COLLECTION,
    });
    assert.equal(save.payload.collectionId, COLLECTION);
    assert.equal(like.payload.collectionId, COLLECTION);
    for (const event of [follow, save, like]) {
      const r = render(event);
      assert.ok(isAllowedDeepLink(r.deep_link), r.deep_link);
      assert.ok(r.group_key);
    }
  });

  it('aggregates distinct actors into one inbox row and ignores a replayed fact', async () => {
    const repo = new InMemoryNotificationRepository();
    repo.addUser(USER, { accountStatus: 'ACTIVE' });
    repo.addUser(ACTOR, { accountStatus: 'ACTIVE' });
    const other = '77777777-7777-4777-8777-777777777777';
    repo.addUser(other, { accountStatus: 'ACTIVE' });
    const svc = new NotificationService(repo);
    const first = creatorFollowedEvent({
      factEventId: FACT,
      recipientUserId: USER,
      actorUserId: ACTOR,
      occurredAt: new Date().toISOString(),
    });
    assert.equal(await svc.emitSafely(first), 'enqueued');
    assert.equal(await svc.emitSafely(first), 'duplicate');
    assert.equal(
      await svc.emitSafely(
        creatorFollowedEvent({
          factEventId: '88888888-8888-4888-8888-888888888888',
          recipientUserId: USER,
          actorUserId: other,
          occurredAt: new Date().toISOString(),
        }),
      ),
      'enqueued',
    );
    await runMaterializerOnce(repo);
    await runMaterializerOnce(repo);
    const page = await svc.listFeed(USER, {});
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].category, 'social');
    assert.equal(page.items[0].actorCount, 2);
  });
});
