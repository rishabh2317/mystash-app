import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPushMessage, payloadBytes, type BegunDelivery } from './pushContent';
import { buildMaterializePush, PUSH_CATEGORY_POLICY, PUSH_PAYLOAD_MAX_BYTES } from './pushPolicy';
import type { ActorProfile } from './types';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const NID = '33333333-3333-4333-8333-333333333333';
const ANA = '44444444-4444-4444-8444-444444444444';

function delivery(overrides: Partial<BegunDelivery> = {}): BegunDelivery {
  return {
    deliveryId: '42',
    attemptNo: 1,
    provider: 'expo',
    token: 'ExponentPushToken[abc]',
    tokenFingerprint: '0123456789abcdef',
    platform: 'ios',
    notificationId: NID,
    type: 'creator.followed',
    category: 'social',
    title: 'New follower',
    body: 'Someone followed you.',
    deepLink: '/notifications',
    groupKey: 'creator.followed:me',
    actorCount: 1,
    sampleActorIds: [ANA],
    sendDeadline: new Date(NOW + 3_600_000).toISOString(),
    ...overrides,
  };
}

const actors = new Map<string, ActorProfile>([
  [ANA, { id: ANA, username: 'Ana', displayName: 'Ana B', profilePhotoUrl: 'https://img/x.jpg' }],
]);

describe('push content', () => {
  it('data carries only routing identifiers, never tokens or profile data', () => {
    const m = buildPushMessage(delivery(), actors, NOW)!;
    assert.deepEqual(Object.keys(m.data).sort(), ['did', 'link', 'nid', 'type', 'v']);
    assert.equal(m.data.nid, NID);
    assert.equal(m.data.did, '42');
    assert.ok(!JSON.stringify(m.data).includes('ExponentPushToken'));
    assert.ok(!JSON.stringify(m.data).includes('img/x.jpg'));
  });

  it('social text is rendered from active actors; a single follow links to the creator', () => {
    const m = buildPushMessage(delivery(), actors, NOW)!;
    assert.equal(m.body, 'Ana B followed you.');
    assert.equal(m.data.link, '/creator/ana');
    assert.equal(m.collapseId, NID);
    assert.equal(m.threadId, 'creator.followed:me');
    const anonymous = buildPushMessage(delivery(), new Map(), NOW)!;
    assert.equal(anonymous.body, 'Someone followed you.');
    assert.equal(anonymous.data.link, '/notifications');
  });

  it('task pushes never quote user content on the lock screen', () => {
    const m = buildPushMessage(
      delivery({
        type: 'collection.publish_succeeded',
        category: 'task',
        title: 'Your Collection is live',
        body: '“My secret haul” is now published.',
        deepLink: `/collection/${NID}`,
        groupKey: null,
        sampleActorIds: [],
        actorCount: 0,
      }),
      actors,
      NOW,
    )!;
    assert.ok(!m.body.includes('secret haul'));
    assert.equal(m.data.link, `/collection/${NID}`);
    assert.equal(m.priority, 'high');
  });

  it('promo broadcasts keep the operator title and body', () => {
    const m = buildPushMessage(
      delivery({
        type: 'promo.broadcast',
        category: 'promo',
        title: 'Something new on Mystash',
        body: 'Open the app to see this week’s picks.',
        groupKey: null,
        sampleActorIds: [],
        actorCount: 0,
      }),
      actors,
      NOW,
    )!;
    assert.equal(m.title, 'Something new on Mystash');
    assert.equal(m.body, 'Open the app to see this week’s picks.');
    assert.equal(m.channelId, undefined);
    assert.equal(
      buildPushMessage(
        delivery({
          type: 'promo.broadcast',
          category: 'promo',
          title: 'Something new on Mystash',
          body: 'Open the app to see this week’s picks.',
          platform: 'android',
          groupKey: null,
        }),
        actors,
        NOW,
      )!.channelId,
      'promo',
    );
  });

  it('account pushes are generic', () => {
    const m = buildPushMessage(
      delivery({ type: 'creator.status_changed', category: 'account', title: 'Creator status updated', body: 'x' }),
      actors,
      NOW,
    )!;
    assert.equal(m.title, 'Account update');
    assert.ok(!m.body.includes('x'));
  });

  it('ttl is the remaining time to the send deadline, and Android gets a channel', () => {
    assert.equal(buildPushMessage(delivery(), actors, NOW)!.ttlSeconds, 3600);
    assert.equal(buildPushMessage(delivery({ sendDeadline: new Date(NOW - 1).toISOString() }), actors, NOW)!.ttlSeconds, 0);
    assert.equal(buildPushMessage(delivery(), actors, NOW)!.channelId, undefined);
    assert.equal(buildPushMessage(delivery({ platform: 'android' }), actors, NOW)!.channelId, 'social');
  });

  it('disallowed deep links fall back to the inbox', () => {
    const m = buildPushMessage(
      delivery({ category: 'task', type: 'ingest.failed', deepLink: 'https://evil.example' }),
      actors,
      NOW,
    )!;
    assert.equal(m.data.link, '/notifications');
  });

  it('keeps payloads under the provider limit, trimming the body or refusing', () => {
    const huge = new Map<string, ActorProfile>([
      [ANA, { id: ANA, username: 'ana', displayName: 'A'.repeat(6000), profilePhotoUrl: null }],
    ]);
    const long = buildPushMessage(delivery(), huge, NOW)!;
    assert.ok(long.body.length < 6000);
    assert.ok(payloadBytes(long) <= PUSH_PAYLOAD_MAX_BYTES);
    const impossible = buildPushMessage(
      delivery({ category: 'task', type: 'ingest.failed', title: 'T'.repeat(5000) }),
      actors,
      NOW,
    );
    assert.equal(impossible, null);
  });
});

describe('push policy', () => {
  it('matches the accepted TTL, retry and rate decisions', () => {
    assert.equal(PUSH_CATEGORY_POLICY.social.ttlSeconds, 6 * 3600);
    assert.equal(PUSH_CATEGORY_POLICY.task.ttlSeconds, 24 * 3600);
    assert.equal(PUSH_CATEGORY_POLICY.account.ttlSeconds, 24 * 3600);
    assert.equal(PUSH_CATEGORY_POLICY.security.ttlSeconds, 3600);
    assert.equal(PUSH_CATEGORY_POLICY.social.retryPolicy, 'no_ambiguous_retry');
    for (const c of ['task', 'account', 'security'] as const) {
      assert.equal(PUSH_CATEGORY_POLICY[c].retryPolicy, 'retry_ambiguous_once');
      assert.equal(PUSH_CATEGORY_POLICY[c].rateCap, null);
    }
    assert.equal(PUSH_CATEGORY_POLICY.social.rateCap, 10);
    assert.equal(PUSH_CATEGORY_POLICY.social.rateWindowSeconds, 24 * 3600);
    assert.equal(PUSH_CATEGORY_POLICY.social.cooldownSeconds, 24 * 3600);
  });

  it('builds the materialize p_push argument', () => {
    assert.deepEqual(buildMaterializePush('social'), {
      enabled: true,
      ttl_seconds: 21600,
      retry_policy: 'no_ambiguous_retry',
      max_send_attempts: 3,
      cooldown_seconds: 86400,
      rate_cap: 10,
      rate_window_seconds: 86400,
      provider_preference: ['expo'],
    });
  });
});
