import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NOTIFICATION_TYPES, buildMaterializeRender } from '../../backend/src/notifications/domain/eventTypes';
import { isAllowedDeepLink } from '../../backend/src/notifications/domain/deepLinks';
import { NOTIFICATIONS_HREF, isAllowedNotificationLink, resolveNotificationHref } from './linking';

const ID = '3f2b8a5e-1c4d-4e6f-9a0b-1c2d3e4f5a6b';

describe('notification deep links on tap', () => {
  it('falls back to the inbox for anything not allowlisted', () => {
    assert.equal(resolveNotificationHref(null), NOTIFICATIONS_HREF);
    assert.equal(resolveNotificationHref('https://evil.example/collection'), NOTIFICATIONS_HREF);
    assert.equal(resolveNotificationHref('/collection/not-a-uuid'), NOTIFICATIONS_HREF);
    assert.equal(resolveNotificationHref(`/collection/${ID}?utm=x`), NOTIFICATIONS_HREF);
    assert.equal(resolveNotificationHref('//evil.example'), NOTIFICATIONS_HREF);
    assert.equal(resolveNotificationHref(`/collection/${ID}`), `/collection/${ID}`);
    assert.equal(resolveNotificationHref(`/(tabs)/create/review?ingestId=${ID}`), `/(tabs)/create/review?ingestId=${ID}`);
  });

  it('accepts every link the server can render, and nothing the server would reject', () => {
    const payload = {
      collectionId: ID,
      ingestId: ID,
      connectedAccountId: ID,
      provider: 'youtube',
      status: 'ACTIVE',
      productCount: 2,
    };
    for (const type of Object.keys(NOTIFICATION_TYPES)) {
      const { deep_link } = buildMaterializeRender({ eventType: type, recipientUserId: ID, payload });
      assert.ok(isAllowedNotificationLink(deep_link), `${type} → ${deep_link}`);
    }
    for (const link of ['/creator/ana.b', '/creator/AB', '/settings', '/analytics', '/notifications', '/cart', '/']) {
      assert.equal(isAllowedNotificationLink(link), isAllowedDeepLink(link), link);
    }
  });
});
