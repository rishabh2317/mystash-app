import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ANDROID_CHANNEL_BY_CATEGORY, buildPushMessage } from '../../backend/src/notifications/domain/pushContent';
import { pushSettingsValue, PUSH_COPY } from '../ui/notificationsInbox';
import {
  ANDROID_CHANNELS,
  REGISTRATION_REFRESH_MS,
  RecentKeys,
  SIGN_IN_HREF,
  canReceivePush,
  decidePrompt,
  mapOsPermission,
  parsePushData,
  pushEnabled,
  pushTapTarget,
  shouldRegister,
  type LastRegistration,
} from './pushPolicy';

const NID = '3f2b8a5e-1c4d-4e6f-9a0b-1c2d3e4f5a6b';
const INSTALL = '55555555-5555-4555-8555-555555555555';
const NOW = 1_800_000_000_000;

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('push gate', () => {
  it('needs both the inbox and the push flag', () => {
    withEnv({ EXPO_PUBLIC_NOTIFICATIONS_ENABLED: undefined, EXPO_PUBLIC_PUSH_ENABLED: undefined }, () =>
      assert.equal(pushEnabled(), false),
    );
    withEnv({ EXPO_PUBLIC_NOTIFICATIONS_ENABLED: 'true', EXPO_PUBLIC_PUSH_ENABLED: undefined }, () =>
      assert.equal(pushEnabled(), false),
    );
    withEnv({ EXPO_PUBLIC_NOTIFICATIONS_ENABLED: undefined, EXPO_PUBLIC_PUSH_ENABLED: 'true' }, () =>
      assert.equal(pushEnabled(), false),
    );
    withEnv({ EXPO_PUBLIC_NOTIFICATIONS_ENABLED: 'true', EXPO_PUBLIC_PUSH_ENABLED: 'true' }, () =>
      assert.equal(pushEnabled(), true),
    );
  });
});

describe('OS permission', () => {
  it('maps expo permission states, including iOS provisional', () => {
    assert.equal(mapOsPermission('granted', 2), 'granted');
    assert.equal(mapOsPermission('granted', 3), 'provisional');
    assert.equal(mapOsPermission('denied', 1), 'denied');
    assert.equal(mapOsPermission('undetermined', 0), 'undetermined');
    assert.equal(mapOsPermission('granted'), 'granted');
    assert.equal(canReceivePush('provisional'), true);
    assert.equal(canReceivePush('denied'), false);
  });

  it('asks only once, only while undetermined, never after a denial', () => {
    assert.equal(decidePrompt({ permission: 'undetermined', canAskAgain: true, explainerShown: false }), 'ask');
    assert.equal(decidePrompt({ permission: 'undetermined', canAskAgain: true, explainerShown: true }), 'skip');
    assert.equal(decidePrompt({ permission: 'undetermined', canAskAgain: false, explainerShown: false }), 'skip');
    assert.equal(decidePrompt({ permission: 'denied', canAskAgain: true, explainerShown: false }), 'skip');
    assert.equal(decidePrompt({ permission: 'granted', canAskAgain: true, explainerShown: false }), 'skip');
  });
});

describe('registration throttle', () => {
  const snapshot = { userId: 'u1', installationId: INSTALL, token: 'ExponentPushToken[a]', osPermission: 'granted' as const, appVersion: '1.0.0' };
  const last: LastRegistration = { ...snapshot, at: NOW };

  it('registers the first time, on any change, and once a day otherwise', () => {
    assert.equal(shouldRegister(null, snapshot, NOW), true);
    assert.equal(shouldRegister(last, snapshot, NOW + 1000), false);
    assert.equal(shouldRegister(last, snapshot, NOW + 1000, true), true);
    assert.equal(shouldRegister(last, snapshot, NOW + REGISTRATION_REFRESH_MS), true);
    assert.equal(shouldRegister(last, { ...snapshot, userId: 'u2' }, NOW), true);
    assert.equal(shouldRegister(last, { ...snapshot, token: 'ExponentPushToken[b]' }, NOW), true);
    assert.equal(shouldRegister(last, { ...snapshot, osPermission: 'provisional' }, NOW), true);
    assert.equal(shouldRegister(last, { ...snapshot, appVersion: '1.1.0' }, NOW), true);
  });
});

describe('push payload and taps', () => {
  it('accepts only the v1 shape and re-allowlists the link', () => {
    assert.deepEqual(parsePushData({ v: 1, nid: NID, did: '42', type: 'ingest.failed', link: `/collection/${NID}` }), {
      nid: NID,
      did: '42',
      type: 'ingest.failed',
      link: `/collection/${NID}`,
    });
    assert.equal(parsePushData({ v: 2, nid: NID }), null);
    assert.equal(parsePushData({ v: 1, nid: 'nope' }), null);
    assert.equal(parsePushData(null), null);
    assert.equal(parsePushData({ v: 1, nid: NID, link: 'https://evil.example' })?.link, '/notifications');
    assert.equal(parsePushData({ v: 1, nid: NID, did: 'x; drop' })?.did, null);
  });

  it('a signed-out tap only reaches sign-in', () => {
    const data = parsePushData({ v: 1, nid: NID, did: '1', link: `/collection/${NID}` });
    assert.equal(pushTapTarget(data, false), SIGN_IN_HREF);
    assert.equal(pushTapTarget(data, true), `/collection/${NID}`);
    assert.equal(pushTapTarget(null, true), '/notifications');
  });

  it('parses exactly what the server sends', () => {
    const message = buildPushMessage(
      {
        deliveryId: '7',
        attemptNo: 1,
        provider: 'expo',
        token: 'ExponentPushToken[a]',
        tokenFingerprint: '0123456789abcdef',
        platform: 'android',
        notificationId: NID,
        type: 'ingest.failed',
        category: 'task',
        title: 't',
        body: 'b',
        deepLink: `/(tabs)/create/review?ingestId=${NID}`,
        groupKey: null,
        actorCount: 0,
        sampleActorIds: [],
        sendDeadline: new Date(NOW + 60_000).toISOString(),
      },
      new Map(),
      NOW,
    )!;
    const data = parsePushData(message.data);
    assert.deepEqual(data, { nid: NID, did: '7', type: 'ingest.failed', link: `/(tabs)/create/review?ingestId=${NID}` });
    assert.ok(ANDROID_CHANNELS.some((c) => c.id === message.channelId));
  });

  it('dedupes by key within the window', () => {
    const keys = new RecentKeys(1000);
    assert.equal(keys.firstSeen(NID, NOW), true);
    assert.equal(keys.firstSeen(NID, NOW + 10), false);
    assert.equal(keys.firstSeen(NID, NOW + 2000), true);
  });
});

describe('Android channels', () => {
  it('exist for every channel the server can target', () => {
    const ids = new Set<string>(ANDROID_CHANNELS.map((c) => c.id));
    for (const channel of Object.values(ANDROID_CHANNEL_BY_CATEGORY)) assert.ok(ids.has(channel), channel);
  });
});

describe('push settings copy', () => {
  it('reflects the OS state', () => {
    assert.equal(pushSettingsValue('granted'), PUSH_COPY.settingsOn);
    assert.equal(pushSettingsValue('provisional'), PUSH_COPY.settingsOn);
    assert.equal(pushSettingsValue('denied'), PUSH_COPY.settingsBlocked);
    assert.equal(pushSettingsValue('undetermined'), PUSH_COPY.settingsOff);
  });
});
