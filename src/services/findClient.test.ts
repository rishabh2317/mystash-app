import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFindClient, type FindItem, FindApiError } from './findClient';
function item(id: string, active = true): FindItem {
  return { id, createdAt: '2026-11-03T00:00:00Z', sourceUrl: 'https://fixture.invalid', sourceType: 'web', contentSourceId: null, title: null, thumbnailUrl: null,
    intent: { kind: null, note: null, revision: 0 }, outcome: { version: 1, category: active ? 'processing' : 'completed', result: active ? 'pending' : 'empty',
      products: active ? 'running' : 'complete', places: 'complete', foundProducts: 0, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0,
      savedProducts: 0, savedPlaces: 0, stashSync: active ? 'pending' : 'complete', extractionActive: active, delayed: false,
      canRetryExtraction: false, canRetrySaving: false, finishedAt: null } };
}
function fixture() {
  let user = 'owner', failure = false;
  const batches: string[][] = [];
  const client = createFindClient({ baseURL: () => 'https://fixture.invalid', session: async () => user ? { userId: user, accessToken: 'dummy' } : null,
    fetch: async (_url, options) => {
      const ids: string[] = JSON.parse(options!.body as string).ids; batches.push(ids);
      if (failure) throw new Error('offline');
      return new Response(JSON.stringify({ items: ids.filter(id => id !== 'gone').map(id => item(id, false)), unavailableIds: ids.filter(id => id === 'gone') }), { status: 200 });
    } });
  return { client, batches, switchUser: (value: string) => { user = value; }, fail: () => { failure = true; } };
}
test('refreshes loaded active records beyond the head page in bounded batches without losing terminal history', async () => {
  const f = fixture(), rows = Array.from({ length: 225 }, (_, i) => item(String(i)));
  rows.push(item('terminal', false)); rows.push(item('gone'));
  const result = await f.client.refreshLoaded(rows, 'owner');
  assert.deepEqual(f.batches.map(ids => ids.length), [100,100,26]); assert.equal(result.length, 226);
  assert.ok(result.every(row => !row.outcome.extractionActive)); assert.equal(result.at(-1)?.id, 'terminal');
  assert.equal(rows[0].outcome.extractionActive, true);
});
test('a failed batch preserves the caller snapshot and never manufactures completion', async () => {
  const f = fixture(), rows = [item('one')]; f.fail();
  await assert.rejects(f.client.refreshLoaded(rows, 'owner'), /offline/); assert.equal(rows[0].outcome.category, 'processing');
});
test('account changes during a request or between chunks reject the entire refresh', async () => {
  let owner = 'A', calls = 0;
  const client = createFindClient({ baseURL: () => 'https://fixture.invalid', session: async () => ({ userId: owner, accessToken: 'dummy' }),
    fetch: async (_url, options) => { calls++; const ids = JSON.parse(options!.body as string).ids; owner = 'B'; return new Response(JSON.stringify({ items: ids.map((id: string) => item(id)), unavailableIds: [] })); } });
  await assert.rejects(client.refreshLoaded(Array.from({ length: 101 }, (_, i) => item(String(i))), 'A'), FindApiError);
  assert.equal(calls, 1);
});
test('terminal records need no polling, while delayed and save-failed records remain refreshable', async () => {
  const f = fixture(), done = [item('done', false)]; assert.equal(await f.client.refreshLoaded(done, 'owner'), done);
  const delayed = item('delayed'); delayed.outcome.delayed = true; delayed.outcome.category = 'attention';
  const saving = item('saving', false); saving.outcome.stashSync = 'failed'; saving.outcome.canRetrySaving = true;
  await f.client.refreshLoaded([delayed, saving], 'owner'); assert.deepEqual(f.batches, [['delayed','saving']]);
});
test('list uses authoritative global counts and preserves opaque cursors', async () => {
  let requested = '';
  const client = createFindClient({ baseURL: () => 'https://fixture.invalid/', session: async () => ({ userId: 'owner', accessToken: 'dummy' }),
    fetch: async url => { requested = String(url); return new Response(JSON.stringify({ items: [item('one', false)], nextCursor: 'next', counts: { all: 1205, processing: 0, completed: 1205, attention: 0, saved: 1 } })); } });
  const page = await client.list({ cursor: 'opaque+/=microseconds', limit: 17, filter: 'saved' });
  assert.equal(page.counts.all, 1205); assert.equal(page.items.length, 1);
  assert.equal(new URL(requested).searchParams.get('cursor'), 'opaque+/=microseconds');
});
test('malformed or foreign batch replies never replace loaded records', async () => {
  for (const result of [{ items: [item('foreign')], unavailableIds: [] }, { items: [], unavailableIds: [] }]) {
    const client = createFindClient({ baseURL: () => 'https://fixture.invalid', session: async () => ({ userId: 'owner', accessToken: 'dummy' }),
      fetch: async () => new Response(JSON.stringify(result)) });
    await assert.rejects(client.refreshLoaded([item('owned')], 'owner'), FindApiError);
  }
});

test('an owner stamp prevents retaining terminal history after an account switch', async () => {
  const f = fixture(); f.switchUser('different-owner');
  await assert.rejects(f.client.refreshLoaded([item('terminal', false)], 'owner'), FindApiError);
  assert.deepEqual(f.batches, []);
});
