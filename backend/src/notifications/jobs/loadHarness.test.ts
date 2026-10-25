import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryNotificationRepository } from '../InMemoryNotificationRepository';
import { runFeedLoad, runOutboxBurst, seedInbox, recipientId } from './loadHarness';
import { NotificationService } from '../NotificationService';

describe('notification load harness', () => {
  it('serves list, unread and read under an in-process server', async () => {
    const result = await runFeedLoad({ feedSize: 40, requests: 20, concurrency: 4 });
    assert.equal(result.list.n, 20);
    assert.equal(result.unread.n, 20);
    assert.equal(result.read.n, 20);
    assert.ok(result.list.p95 < 500);
    assert.ok(result.unread.p95 < 500);
  });

  it('drains an outbox burst after a mid-run restart without Redis', async () => {
    const result = await runOutboxBurst({ count: 1_200, restartAfter: 500, leaseSeconds: 1 });
    assert.equal(result.enqueued, 1_200);
    assert.equal(result.materialized, 1_200);
    assert.ok(result.restartedAfter >= 500);
    assert.equal(result.fakePushMessages, 1_200);
    assert.equal(result.redisUsed, false);
    const repo = new InMemoryNotificationRepository();
    await seedInbox(repo, 3, recipientId(), new Date().toISOString());
    const unread = await new NotificationService(repo).unreadCount(recipientId());
    assert.equal(unread.unread, 3);
  });
});
