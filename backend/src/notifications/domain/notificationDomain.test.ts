import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATIONS_FALLBACK_LINK, isAllowedDeepLink, safeDeepLink } from './deepLinks';
import {
  InvalidNotificationPayloadError,
  NOTIFICATION_TYPES,
  buildMaterializeRender,
} from './eventTypes';
import { engagementFactKey, ingestTerminalKey, publishSucceededKey } from './idempotencyKeys';
import { isConfigurablePair, isIanaTimeZone, normalizeClock, resolveSettings } from './preferencePolicy';
import { NOTIFICATION_RETENTION, outboxRetrySeconds } from './policy';
import { decodeFeedCursor, describeActors, encodeFeedCursor, toNotificationView } from './render';
import type { NotificationEventType, NotificationRecord } from './types';

const ID = '3f2b8a5e-1c4d-4e6f-9a0b-1c2d3e4f5a6b';
const RECIPIENT = '11111111-1111-4111-8111-111111111111';

const SAMPLE_PAYLOADS: Record<NotificationEventType, Record<string, unknown>> = {
  'collection.publish_succeeded': { collectionId: ID, collectionTitle: 'Summer kit' },
  'collection.publish_failed': { collectionId: ID, ingestId: ID },
  'ingest.ready_for_review': { ingestId: ID, videoTitle: 'My reel' },
  'ingest.failed': { ingestId: ID },
  'creator_library.sync_failed': { connectedAccountId: ID, provider: 'youtube' },
  'connected_account.needs_reauth': { connectedAccountId: ID, provider: 'instagram' },
  'creator.status_changed': { status: 'ACTIVE' },
  'creator.followed': {},
  'collection.saved': { collectionId: ID },
  'reel.liked': { collectionId: ID },
  'promo.broadcast': { campaignId: ID, title: 'Something new', body: 'Open Mystash.', deepLink: '/notifications' },
};

describe('idempotency keys', () => {
  it('derives keys from source records only and strips separators', () => {
    assert.equal(engagementFactKey('evt-1'), 'fact:evt-1');
    assert.equal(
      publishSucceededKey(ID, '2026-10-12T08:00:00.000Z'),
      `collection:${ID}:published:2026-10-12T08_00_00.000Z`,
    );
    assert.notEqual(
      ingestTerminalKey(ID, 'failed', '2026-10-12T08:00:00.000Z'),
      ingestTerminalKey(ID, 'failed', '2026-10-12T09:00:00.000Z'),
    );
    assert.throws(() => engagementFactKey('   '));
  });
});

describe('deep links', () => {
  it('allows only known routes and falls back to the inbox', () => {
    assert.ok(isAllowedDeepLink(`/collection/${ID}`));
    assert.ok(isAllowedDeepLink(`/(tabs)/create/review?ingestId=${ID}`));
    assert.ok(isAllowedDeepLink('/creator/ana.b'));
    assert.equal(safeDeepLink('https://evil.example'), NOTIFICATIONS_FALLBACK_LINK);
    assert.equal(safeDeepLink('/collection/not-a-uuid'), NOTIFICATIONS_FALLBACK_LINK);
    assert.equal(safeDeepLink(`/collection/${ID}?x=1`), NOTIFICATIONS_FALLBACK_LINK);
  });
});

describe('event type registry', () => {
  for (const type of Object.keys(NOTIFICATION_TYPES) as NotificationEventType[]) {
    it(`renders ${type} with an allowlisted link and bounded text`, () => {
      const render = buildMaterializeRender({
        eventType: type,
        recipientUserId: RECIPIENT,
        payload: SAMPLE_PAYLOADS[type],
      });
      assert.ok(isAllowedDeepLink(render.deep_link), render.deep_link);
      assert.ok(render.title.length <= 120 && render.body.length <= 400);
      assert.equal(render.requires_actor, NOTIFICATION_TYPES[type].requiresActor);
      if (render.requires_actor) {
        assert.ok(render.group_key, 'social types aggregate');
        assert.match(render.body, /^Someone /, 'stored text never names actors');
      } else {
        assert.equal(render.group_key, null);
      }
    });
  }

  it('registers no security producers until a trustworthy auth-event source exists', () => {
    const security = Object.entries(NOTIFICATION_TYPES).filter(([, def]) => def.category === 'security');
    assert.deepEqual(security, []);
  });

  it('rejects unknown types and missing payload fields as non-retryable', () => {
    assert.throws(
      () => buildMaterializeRender({ eventType: 'nope', recipientUserId: RECIPIENT, payload: {} }),
      InvalidNotificationPayloadError,
    );
    assert.throws(
      () => buildMaterializeRender({ eventType: 'ingest.failed', recipientUserId: RECIPIENT, payload: {} }),
      InvalidNotificationPayloadError,
    );
  });

  it('groups follows per recipient and saves per collection', () => {
    const follow = buildMaterializeRender({ eventType: 'creator.followed', recipientUserId: RECIPIENT, payload: {} });
    assert.equal(follow.group_key, `creator.followed:${RECIPIENT}`);
    const save = buildMaterializeRender({
      eventType: 'collection.saved',
      recipientUserId: RECIPIENT,
      payload: { collectionId: ID },
    });
    assert.equal(save.group_key, `collection.saved:${ID}`);
  });
});

describe('read-time rendering', () => {
  const base: NotificationRecord = {
    id: ID,
    userId: RECIPIENT,
    type: 'creator.followed',
    category: 'social',
    title: 'New follower',
    body: 'Someone followed you.',
    data: {},
    deepLink: '/notifications',
    groupKey: `creator.followed:${RECIPIENT}`,
    actorCount: 3,
    sampleActorIds: ['a', 'b'],
    sortAt: '2026-10-12T08:00:00.123456+00:00',
    seenAt: null,
    readAt: null,
    createdAt: '2026-10-12T08:00:00.123456+00:00',
  };

  it('names only visible actors', () => {
    const actors = new Map([['a', { id: 'a', username: 'ana', displayName: 'Ana', profilePhotoUrl: null }]]);
    const view = toNotificationView(base, actors);
    assert.equal(view.title, 'New followers');
    assert.equal(view.body, 'Ana and 2 others followed you.');
    assert.equal(view.actors.length, 1);
    assert.equal(view.read, false);
  });

  it('describes hidden actors without names', () => {
    assert.equal(describeActors([], 1), 'Someone');
    assert.equal(describeActors([], 4), '4 people');
  });

  it('links a single follower to their profile', () => {
    const actors = new Map([['a', { id: 'a', username: 'ana', displayName: null, profilePhotoUrl: null }]]);
    const view = toNotificationView({ ...base, actorCount: 1, sampleActorIds: ['a'] }, actors);
    assert.equal(view.deepLink, '/creator/ana');
    assert.equal(view.body, 'ana followed you.');
  });

  it('round-trips cursors without losing microseconds', () => {
    const cursor = { sortAt: base.sortAt, id: ID };
    assert.deepEqual(decodeFeedCursor(encodeFeedCursor(cursor)), cursor);
    assert.equal(decodeFeedCursor('garbage'), null);
  });
});

describe('policy', () => {
  it('keeps event keys longer than the stale cutoff', () => {
    assert.ok(NOTIFICATION_RETENTION.eventKeyDays > NOTIFICATION_RETENTION.staleAfterDays);
  });

  it('backs off exponentially within bounds', () => {
    const mid = () => 0.5;
    assert.equal(outboxRetrySeconds(0, mid), 5);
    assert.equal(outboxRetrySeconds(3, mid), 40);
    assert.equal(outboxRetrySeconds(20, mid), 900);
  });
});

describe('preference policy', () => {
  it('keeps task inbox and security channels off the configurable list', () => {
    assert.equal(isConfigurablePair('task', 'inbox'), false);
    assert.equal(isConfigurablePair('security', 'push'), false);
    assert.equal(isConfigurablePair('social', 'inbox'), true);
    assert.equal(normalizeClock('22:00'), '22:00:00');
    assert.equal(isIanaTimeZone('America/Los_Angeles'), true);
    assert.equal(isIanaTimeZone('Not/A_Zone'), false);
    const resolved = resolveSettings({ stored: [], timezone: null, quietHours: null, promoOptedIn: false });
    assert.equal(resolved.preferences.find((p) => p.category === 'promo' && p.channel === 'push')?.enabled, false);
    assert.equal(resolved.preferences.find((p) => p.category === 'social' && p.channel === 'inbox')?.enabled, true);
  });
});
