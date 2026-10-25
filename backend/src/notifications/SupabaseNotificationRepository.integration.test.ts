import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseNotificationRepository } from './SupabaseNotificationRepository';
import { buildMaterializeRender } from './domain/eventTypes';
import { STALE_AFTER_SECONDS } from './domain/policy';
import type { EnqueueEventInput } from './domain/types';

import { assertSafeTestTarget } from './testing/databaseTargetGuard';

/**
 * Baseline: local Supabase after `npm run db:reset:local` (repo root). Needs SUPABASE_TEST_URL +
 * SUPABASE_TEST_SERVICE_ROLE_KEY; staging requires NOTIFICATIONS_TEST_TARGET=staging; production is refused.
 */
const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const skip = !url || !key ? 'SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY not set' : false;

describe('SupabaseNotificationRepository (integration)', { skip }, () => {
  let admin: SupabaseClient;
  let repo: SupabaseNotificationRepository;
  const userIds: string[] = [];

  async function createAuthUser(): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email: `ntf-${randomUUID()}@example.test`,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error('createUser failed');
    userIds.push(data.user.id);
    return data.user.id;
  }

  before(() => {
    assertSafeTestTarget(url as string, process.env.NOTIFICATIONS_TEST_TARGET);
    admin = createClient(url as string, key as string, { auth: { persistSession: false } });
    repo = new SupabaseNotificationRepository(admin);
  });

  after(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it('enqueues once, materializes with a fenced lease, aggregates, and purges actors', async () => {
    const recipient = await createAuthUser();
    const fanA = await createAuthUser();
    const fanB = await createAuthUser();
    const occurredAt = new Date().toISOString();
    const event = (actor: string, fact: string): EnqueueEventInput => ({
      eventType: 'creator.followed',
      idempotencyKey: `fact:${fact}`,
      recipientUserId: recipient,
      actorUserId: actor,
      occurredAt,
      payload: {},
    });

    const factA = randomUUID();
    assert.equal((await repo.enqueueEvent(event(fanA, factA), STALE_AFTER_SECONDS)).outcome, 'enqueued');
    assert.equal((await repo.enqueueEvent(event(fanA, factA), STALE_AFTER_SECONDS)).outcome, 'duplicate');
    await repo.enqueueEvent(event(fanB, randomUUID()), STALE_AFTER_SECONDS);

    const claimed = (await repo.claimOutbox(500, 60, 10)).filter((c) => c.recipientUserId === recipient);
    assert.equal(claimed.length, 2);
    for (const c of claimed) {
      const render = buildMaterializeRender(c);
      assert.notEqual((await repo.materialize(c.outboxId, c.leaseToken, render)).outcome, 'lease_lost');
      assert.equal((await repo.materialize(c.outboxId, c.leaseToken, render)).outcome, 'lease_lost');
    }

    let [row] = await repo.listFeed(recipient, { before: null, limit: 10, category: null });
    assert.equal(row.actorCount, 2);
    assert.equal(await repo.unreadCount(recipient), 1);

    const purge = await repo.purgeUser(fanA, 1000);
    assert.equal(purge.done, true);
    [row] = await repo.listFeed(recipient, { before: null, limit: 10, category: null });
    assert.equal(row.actorCount, 1);
    assert.deepEqual(row.sampleActorIds, [fanB]);

    assert.equal(await repo.recordOpen(fanB, row.id), false);
    assert.equal(await repo.recordOpen(recipient, row.id), true);
  });
});
