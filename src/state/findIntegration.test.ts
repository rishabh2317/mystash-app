import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFindClient } from '@/src/services/findClient';
import { findFixture, findDetailFixture } from '@/src/ui/findTestFixtures';
import { createFindHistoryController } from './findHistoryController';
import { createFindDetailController } from './findDetailController';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const timers = { schedule: () => 0, cancel: () => {} };

test('history integrates transport, global counts, 1205-record pagination and bounded foreground refresh', async () => {
  let rows = Array.from({ length: 1205 }, (_, n) => findFixture(n+1, n === 999 ? 'processing' : 'completed'));
  const batches: number[] = [], cursors = new Map<string, number>();
  const counts = () => ({ all: rows.length, completed: rows.filter(row => row.outcome.category === 'completed').length, processing: rows.filter(row => row.outcome.category === 'processing').length, attention: 0, saved: rows.length });
  const api = createFindClient({ baseURL: () => 'https://fixture.invalid', session: async () => ({ userId: 'owner', accessToken: 'dummy' }),
    fetch: async (input, options) => {
      assert.equal((options?.headers as Record<string,string>).Authorization, 'Bearer dummy');
      const url = new URL(String(input));
      if (url.pathname === '/finds/batch') {
        const ids: string[] = JSON.parse(options!.body as string).ids; batches.push(ids.length);
        return Response.json({ items: rows.filter(row => ids.includes(row.id)), unavailableIds: ids.filter(id => !rows.some(row => row.id === id)) });
      }
      const cursor = url.searchParams.get('cursor'), start = cursor ? cursors.get(cursor)! : 0;
      const nextCursor = start+20 < rows.length ? `opaque+/=${start+20}` : null;
      if (nextCursor) cursors.set(nextCursor,start+20);
      return Response.json({ items: rows.slice(start,start+20), nextCursor, counts: counts() });
    } });
  const controller = createFindHistoryController(api,timers);
  controller.configure('owner','all'); controller.setActive(true); await flush();
  assert.equal(controller.getState().items.length,20); assert.equal(controller.getState().counts?.completed,1204);
  while (controller.getState().cursor) await controller.loadMore();
  assert.equal(controller.getState().items.length,1205);
  assert.equal(new Set(controller.getState().items.map(row => row.id)).size,1205);
  const work = rows[999]; rows[999] = { ...work, outcome: { ...work.outcome, category: 'completed', extractionActive: false, stashSync: 'complete' } };
  await controller.refresh(false);
  assert.deepEqual(batches,[1]); assert.equal(controller.getState().counts?.processing,0);
  assert.equal(controller.getState().items[999].outcome.category,'completed');
  const removed = rows[900].id; rows = rows.filter(row => row.id !== removed);
  await controller.refresh();
  assert.ok(batches.every(size => size <= 100)); assert.equal(controller.getState().items.length,1204);
  assert.ok(!controller.getState().items.some(row => row.id === removed));
  controller.setActive(false);
});

test('detail transport actions reload explicit membership tokens and automatic-save completion updates Stash', async () => {
  let detail = findDetailFixture(), owner = 'owner', changed = 0;
  const writes: { method: string; path: string; body: unknown }[] = [];
  const api = createFindClient({ baseURL: () => 'https://fixture.invalid', session: async () => ({ userId: owner, accessToken: 'dummy' }),
    fetch: async (input, options) => {
      const path = new URL(String(input)).pathname, method = options!.method!;
      if (method !== 'GET') {
        writes.push({ method,path,body: JSON.parse(options!.body as string) });
        const restore = path.endsWith('/restore');
        detail = { ...detail, outcome: { ...detail.outcome, savedProducts: restore ? 2 : 1 }, products: detail.products.map((row,n) => n ? row : { ...row,saved: restore,removed: !restore }) };
        return Response.json({ ok: true });
      }
      return Response.json(detail);
    } });
  const controller = createFindDetailController(api,timers,() => { changed++; });
  controller.configure(owner,detail.id); controller.setActive(true); await flush();
  const product = detail.products[0];
  assert.equal(await controller.run('remove',() => api.removeResult(detail.id,'products',product.id,product.identityKey!)),true);
  assert.equal(controller.getState().data?.products[0].removed,true);
  assert.equal(await controller.run('restore',() => api.restoreResult(detail.id,'products',product.id,product.identityKey!)),true);
  assert.equal(controller.getState().data?.products[0].saved,true);
  assert.deepEqual(writes.map(write => [write.method,write.body]),[['DELETE',{ expectedIdentity: product.identityKey }],['POST',{ expectedIdentity: product.identityKey }]]);
  assert.equal(changed,2);
  detail = { ...detail,outcome: { ...detail.outcome,savedProducts: 3 } }; await controller.refresh(); assert.equal(changed,3);
  owner = 'other'; controller.configure(owner,detail.id); controller.setActive(false);
  assert.equal(controller.getState().data,null);
});
