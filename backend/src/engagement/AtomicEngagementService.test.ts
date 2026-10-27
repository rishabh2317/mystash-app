import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AtomicEngagementService } from './AtomicEngagementService';
import { NOOP_NOTIFICATION_EMITTER } from '../notifications/producers';

function fixture(result: unknown, error: { code: string; message: string } | null = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const notifications: unknown[] = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data: result, error }; },
    from(table: string) {
      assert.equal(table, 'engagement_counter_projections', 'no application-side fact/edge/mirror writes');
      const chain = { select: () => chain, eq: () => chain, then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve) };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { service: new AtomicEngagementService(admin, { ...NOOP_NOTIFICATION_EMITTER,
    async emitSafely(input) { notifications.push(input); return null; },
  }), calls, notifications };
}
const fact = { id: 'fact', event_id: 'event', interaction_type: 'view', object_type: 'collection',
  object_id: 'collection', collection_id: 'collection', actor_user_id: 'actor', creator_id: 'owner',
  occurred_at: '2026-10-27T00:00:00Z', created_at: '2026-10-27T00:00:00Z', metadata: {} };

describe('atomic engagement adapter', () => {
  it('uses one transactional RPC and reports duplicate delivery truthfully', async () => {
    const { service, calls } = fixture({ fact, inserted: false, edge: null });
    const result = await service.recordCollectionView({ eventId: 'event', collectionId: 'collection',
      actorUserId: 'actor', creatorId: 'untrusted-owner' });
    assert.equal(result.inserted, false);
    assert.equal(result.creatorId, 'owner');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'engagement_commit');
    const payload = calls[0].args.p_fact as Record<string, unknown>;
    assert.equal(payload.creator_id, null, 'ownership is resolved by SQL');
  });
  it('maps idempotency collisions to 409 and does not fall back to nontransactional writes', async () => {
    const { service, calls } = fixture(null, { code: '23505', message: 'event conflict' });
    await assert.rejects(service.recordCollectionView({ eventId: 'event', collectionId: 'collection', anonymousId: 'guest' }),
      (e: unknown) => (e as { statusCode: number }).statusCode === 409);
    assert.equal(calls.length, 1);
  });
  it('fails closed when the migration is unavailable without leaking database details', async () => {
    const { service } = fixture(null, { code: 'PGRST202', message: 'private database diagnostics' });
    await assert.rejects(service.recordCollectionView({ eventId: 'event', collectionId: 'collection', anonymousId: 'guest' }),
      (e: unknown) => (e as Error).message === 'Engagement write failed');
  });
  it('bounds retries of rolled-back SQL transactions and reuses their event identity', async () => {
    const { service, calls } = fixture(null, { code: '40P01', message: 'deadlock' });
    await assert.rejects(service.recordCollectionView({ eventId: 'retry-event', collectionId: 'collection', anonymousId: 'guest' }));
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => (c.args.p_fact as { event_id: string }).event_id === 'retry-event'));
  });
  it('does not acknowledge an old follow as active after it was removed', async () => {
    const { service } = fixture({ fact: { ...fact, interaction_type: 'follow', object_type: 'creator', collection_id: null },
      inserted: false, edge: { id: 'edge', object_id: 'owner', object_type: 'creator', state: 'REMOVED' } });
    await assert.rejects(service.followCreator({ eventId: 'event', userId: 'actor', creatorId: 'owner' }),
      (e: unknown) => (e as { statusCode: number }).statusCode === 409);
  });
  it('preserves follow notifications but does not notify for unchanged membership', async () => {
    const edge = { id: 'edge', object_id: 'owner', object_type: 'creator', state: 'ACTIVE', source_event_id: 'event' };
    const created = fixture({ fact: { ...fact, interaction_type: 'follow', object_type: 'creator', collection_id: null }, inserted: true, edge });
    await created.service.followCreator({ eventId: 'event', userId: 'actor', creatorId: 'owner' });
    assert.equal(created.notifications.length, 1);
    const unchanged = fixture({ fact: null, inserted: false, edge });
    await unchanged.service.followCreator({ eventId: 'new-event', userId: 'actor', creatorId: 'owner' });
    assert.equal(unchanged.notifications.length, 0);
  });
  it('only sends a merchant host and provider context, never the destination query or path', async () => {
    const { service, calls } = fixture({ fact: { ...fact, interaction_type: 'merchant_click',
      object_type: 'catalog_product', collection_id: null }, inserted: true, edge: null });
    await service.recordMerchantClicked({ eventId: 'click', catalogProductId: 'product',
      destinationUrl: 'https://shop.example/item/private?token=secret#fragment' });
    const metadata = (calls[0].args.p_fact as { metadata: Record<string, unknown> }).metadata;
    assert.equal(metadata.destinationHost, 'shop.example');
    assert.doesNotMatch(JSON.stringify(metadata), /private|secret|token|fragment/);
  });
});
