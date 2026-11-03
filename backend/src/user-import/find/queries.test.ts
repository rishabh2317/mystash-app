import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FindQueryService } from './queryService';
import { ShareError } from '../share/contracts';
import { projectFindOutcome } from './outcome';
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const outcome = projectFindOutcome({ foundProducts: 0, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0,
  savedProducts: 0, savedPlaces: 0, missingProducts: 0, missingPlaces: 0,
  snapshot: { source: null, progress: null, syncState: null, syncAttemptId: null, startedAt: '2026-11-03T00:00:00Z' } });
function fixture(data: unknown, error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args });
    return { abortSignal: async (signal: AbortSignal) => { assert.ok(signal); return { data, error }; } }; } } as unknown as SupabaseClient;
  return { service: new FindQueryService(db), calls };
}
test('list retains PostgreSQL microseconds and uses full-history database counts', async () => {
  const cursor = { created_at: '2026-11-03T00:00:00.123456+00:00', id };
  const f = fixture({ items: [{ id, outcome }], cursor, counts: { all: 1205, processing: 10, completed: 1195, attention: 0, saved: 1 } });
  const result = await f.service.list(id, { cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url'), limit: '17', filter: 'processing' });
  assert.equal(f.calls[0].args.p_before, cursor.created_at); assert.equal(f.calls[0].args.p_before_id, id);
  assert.equal(f.calls[0].args.p_limit, 17); assert.equal(f.calls[0].args.p_user, id);
  assert.equal(result.counts.all, 1205); assert.equal(result.items.length, 1);
  assert.deepEqual(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()), cursor);
});
test('query validation rejects malformed cursors, filters and limits before storage', async () => {
  const f = fixture({});
  for (const query of [{ cursor: "bad'),or(user_id.eq.x)" }, { filter: ['all'] }, { filter: 'review' }, { limit: 0 }, { limit: 51 }, { limit: [] }]) {
    await assert.rejects(f.service.list(id, query), ShareError);
  }
  assert.equal(f.calls.length, 0);
});
test('batch refresh is bounded, deduplicated, and does not reveal why a requested ID is unavailable', async () => {
  const f = fixture({ items: [{ id, outcome }] });
  const batch = await f.service.batch(id, [id, other, id]);
  assert.deepEqual(f.calls[0].args.p_ids, [id, other]); assert.deepEqual(batch.unavailableIds, [other]);
  for (const ids of [[], Array(101).fill(id), ['not-an-id'], 'all']) await assert.rejects(f.service.batch(id, ids), ShareError);
});
test('detail/actions bind owner, Find and result IDs, and safely classify storage errors', async () => {
  const f = fixture({ id, outcome, products: [], places: [] });
  await f.service.detail(id, other); assert.equal(f.calls[0].args.p_user, id); assert.equal(f.calls[0].args.p_import, other);
  await f.service.resultAction(id, other, 'product', id, false, `c:${id}`); assert.equal(f.calls[1].args.p_restore, false);
  for (const [code, status] of [['P0002',404],['23514',409],['55P03',503]] as const) {
    await assert.rejects(fixture(null, { code }).service.detail(id, other), (e: unknown) => e instanceof ShareError && e.status === status);
  }
});
