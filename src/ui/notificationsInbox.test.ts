import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { NotificationItem } from '@/src/services/notificationsApi';
import {
  NOTIFICATIONS_COPY,
  formatNotificationTime,
  markItemsReadLocally,
  mergeNotificationPages,
  notificationAvatarUrl,
  notificationIcon,
  sectionNotifications,
  unreadBadgeLabel,
} from './notificationsInbox';

const ROOT = path.resolve(__dirname, '../..');

function item(id: string, patch: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    type: 'ingest.ready_for_review',
    category: 'task',
    title: 'Products ready to review',
    body: 'We found products in your video.',
    deepLink: '/notifications',
    actors: [],
    actorCount: 0,
    read: false,
    seen: false,
    createdAt: '2026-10-12T08:00:00.000Z',
    updatedAt: '2026-10-12T08:00:00.000Z',
    ...patch,
  };
}

describe('notifications inbox presentation', () => {
  it('caps the badge and hides it at zero', () => {
    assert.equal(unreadBadgeLabel({ unread: 0, capped: false }), '');
    assert.equal(unreadBadgeLabel({ unread: 7, capped: false }), '7');
    assert.equal(unreadBadgeLabel({ unread: 100, capped: true }), '99+');
    assert.equal(NOTIFICATIONS_COPY.bellLabel({ unread: 3, capped: false }), 'Notifications, 3 unread');
    assert.equal(NOTIFICATIONS_COPY.bellLabel({ unread: 0, capped: false }), 'Notifications');
  });

  it('formats compact relative times', () => {
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    assert.equal(formatNotificationTime('2026-10-12T11:59:30.000Z', now), 'now');
    assert.equal(formatNotificationTime('2026-10-12T11:55:00.000Z', now), '5m');
    assert.equal(formatNotificationTime('2026-10-12T09:00:00.000Z', now), '3h');
    assert.equal(formatNotificationTime('2026-10-10T12:00:00.000Z', now), '2d');
    assert.equal(formatNotificationTime('2026-09-01T12:00:00.000Z', now), 'Sep 1');
    assert.equal(formatNotificationTime('garbage', now), '');
  });

  it('sections by last update and drops empty sections', () => {
    const now = new Date(2026, 9, 12, 15, 0).getTime();
    const sections = sectionNotifications(
      [
        item('a', { updatedAt: new Date(2026, 9, 12, 9, 0).toISOString() }),
        item('b', { updatedAt: new Date(2026, 9, 9, 9, 0).toISOString() }),
        item('c', { updatedAt: new Date(2026, 8, 1, 9, 0).toISOString() }),
      ],
      now,
    );
    assert.deepEqual(
      sections.map((s) => [s.title, s.data.map((d) => d.id)]),
      [
        ['Today', ['a']],
        ['This week', ['b']],
        ['Earlier', ['c']],
      ],
    );
    assert.deepEqual(sectionNotifications([], now), []);
  });

  it('merges pages without duplicating aggregates that moved', () => {
    const merged = mergeNotificationPages([item('a'), item('b')], [item('b'), item('c')]);
    assert.deepEqual(
      merged.map((i) => i.id),
      ['a', 'b', 'c'],
    );
  });

  it('marks read locally by id or all', () => {
    const items = [item('a'), item('b', { read: true })];
    assert.deepEqual(
      markItemsReadLocally(items, new Set(['a'])).map((i) => i.read),
      [true, true],
    );
    assert.equal(markItemsReadLocally(items, 'all')[0].seen, true);
    assert.equal(markItemsReadLocally(items, new Set())[0].read, false);
  });

  it('shows actor photos only on social rows and icons otherwise', () => {
    const actor = { id: 'u', username: 'ana', displayName: null, profilePhotoUrl: 'https://img/ana.jpg' };
    assert.equal(notificationAvatarUrl(item('a', { category: 'social', actors: [actor] })), 'https://img/ana.jpg');
    assert.equal(notificationAvatarUrl(item('a', { category: 'task', actors: [actor] })), null);
    assert.equal(notificationIcon('connected_account.needs_reauth'), 'link-outline');
    assert.equal(notificationIcon('promo.broadcast'), 'sparkles-outline');
    assert.equal(notificationIcon('something.new'), 'notifications-outline');
  });
});

describe('notifications Release A wiring', () => {
  it('registers the inbox screen and provider in the root layout', () => {
    const layout = readFileSync(path.join(ROOT, 'app/_layout.tsx'), 'utf8');
    assert.match(layout, /<Stack\.Screen name="notifications"/);
    assert.match(layout, /<NotificationsProvider>/);
    assert.ok(
      layout.indexOf('<AuthProvider>') < layout.indexOf('<NotificationsProvider>'),
      'NotificationsProvider needs the signed-in user',
    );
  });

  it('routes the profile bell to the inbox only when the flag is on', () => {
    const profile = readFileSync(path.join(ROOT, 'app/(tabs)/profile.tsx'), 'utf8');
    assert.match(profile, /notifications\.enabled \? NOTIFICATIONS_HREF : '\/settings'/);
  });

  it('exposes a notification settings screen from Settings', () => {
    const hub = readFileSync(path.join(ROOT, 'app/settings/index.tsx'), 'utf8');
    const screen = readFileSync(path.join(ROOT, 'app/settings/notifications.tsx'), 'utf8');
    assert.match(hub, /\/settings\/notifications/);
    assert.match(screen, /updateNotificationSettings/);
    assert.match(screen, /quietHours/);
  });

  it('never prompts for OS notification permission in Release A', () => {
    for (const file of ['app/notifications.tsx', 'contexts/NotificationsContext.tsx', 'app/(tabs)/profile.tsx']) {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      assert.doesNotMatch(source, /expo-notifications|requestPermissionsAsync/, file);
    }
  });
});
