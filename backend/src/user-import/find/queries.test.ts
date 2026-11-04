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
  for (const query of [{ cursor: "bad'),or(user_id.eq.x)" }, { filter: ['all'] }, { filter: 'review' }, { source: ['youtube'] }, { source: 'camera' }, { limit: 0 }, { limit: 51 }, { limit: [] }]) {
    await assert.rejects(f.service.list(id, query), ShareError);
  }
  assert.equal(f.calls.length, 0);
});
test('source and status use the new scoped RPC while old list and counts keep their contracts', async () => {
  const f = fixture({ items: [{ id, outcome }], cursor: null, counts: { all: 7, processing: 2, completed: 4, attention: 1, saved: 3 } });
  const page = await f.service.list(id, { source: 'youtube', filter: 'processing', limit: '1' });
  assert.equal(f.calls[0].name, 'find_query_by_source');
  assert.equal(f.calls[0].args.p_source, 'youtube');
  assert.equal(f.calls[0].args.p_filter, 'processing');
  assert.equal(page.counts.all, 7);
  await f.service.list(id, { source: 'all' });
  await f.service.counts(id);
  assert.deepEqual(f.calls.slice(1).map(call => call.name), ['find_query','find_query']);
});
test('saved-result-kind combines with source/status and does not change the global counts endpoint', async () => {
  const f = fixture({ items: [{ id, outcome }], cursor: null, counts: { all: 1, processing: 0, completed: 0, attention: 1, saved: 1 } });
  await f.service.list(id, { source: 'image', filter: 'attention', savedKind: 'place' });
  assert.equal(f.calls[0].name, 'find_query_by_source_kind');
  assert.deepEqual([f.calls[0].args.p_source,f.calls[0].args.p_saved_kind,f.calls[0].args.p_filter],['image','place','attention']);
  await f.service.counts(id);
  assert.equal(f.calls[1].name, 'find_query');
  for (const savedKind of ['places', [], 1]) await assert.rejects(f.service.list(id, { savedKind }), ShareError);
  assert.equal(f.calls.length, 2);
});
test('source projections validate owner, cursors, limits and RPC contracts', async () => {
  const f = fixture({ items: [], cursor: null });
  const summaries = await f.service.sourceSummaries(id,{kind:'place',limit:'5'});
  assert.deepEqual(summaries,{items:[],nextCursor:null});
  assert.equal(f.calls[0].name,'find_source_summaries');
  assert.equal(f.calls[0].args.p_user,id);
  const results = await f.service.sourceResults(id,other,{limit:3});
  assert.deepEqual(results,{items:[],nextCursor:null});
  assert.equal(f.calls[1].name,'find_source_results');
  assert.equal(f.calls[1].args.p_import,other);
  for (const query of [{kind:'images'},{limit:0},{cursor:'bad'}]) await assert.rejects(f.service.sourceSummaries(id,query),ShareError);
  for (const query of [{limit:51},{cursor:'bad'}]) await assert.rejects(f.service.sourceResults(id,other,query),ShareError);
  assert.equal(f.calls.length,2);
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
