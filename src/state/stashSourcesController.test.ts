import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStashSourcesController } from './stashSourcesController';
import type { FindSourceSummary, FindSourceSummaryPage } from '@/src/services/findClient';

const row = (n: number): FindSourceSummary => ({ id: String(n).padStart(3, '0'), createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(), title: `Source ${n}`, sourceType: 'youtube', savedProducts: 4, savedPlaces: 3, images: [] });
const page = (items: FindSourceSummary[], nextCursor: string | null = null): FindSourceSummaryPage => ({ items, nextCursor });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

test('mixed source rail merges both keyset streams before pagination and retains unused heads', async () => {
  const calls: string[] = [];
  const controller = createStashSourcesController(async (kind, cursor, owner) => {
    assert.equal(owner, 'A'); calls.push(`${kind}:${cursor}`);
    const all = Array.from({ length: 35 }, (_, i) => row(35 - i));
    const selected = all.filter((_, i) => kind === 'product' ? i % 2 === 0 || i === 1 : i % 2 === 1 || i === 0);
    const offset = Number(cursor ?? 0);
    return page(selected.slice(offset, offset + 5), offset + 5 < selected.length ? String(offset + 5) : null);
  });
  controller.configure('A'); controller.setActive(true); await controller.refresh();
  assert.deepEqual(controller.getState().items.map(item => item.id), Array.from({ length: 20 }, (_, i) => row(35 - i).id));
  assert.equal(controller.getState().hasMore, true);
  const count = calls.length;
  controller.configure('A'); controller.setActive(true); // Product/Place selection does not configure a different reader.
  assert.equal(calls.length, count); assert.equal(controller.getState().items.length, 20);
  await controller.loadMore();
  assert.deepEqual(controller.getState().items.map(item => item.id), Array.from({ length: 35 }, (_, i) => row(35 - i).id));
  assert.equal(controller.getState().hasMore, false); assert.equal(new Set(controller.getState().items.map(item => item.id)).size, 35);
});

test('refresh retains visible cards on failure and retries without losing mixed results', async () => {
  let fail = false;
  const controller = createStashSourcesController(async kind => { if (fail) throw Error('offline'); return page([row(kind === 'product' ? 2 : 1)]); });
  controller.configure('A'); controller.setActive(true); await controller.refresh(); fail = true;
  const pending = controller.refresh(); assert.equal(controller.getState().items.length, 2); await pending;
  assert.equal(controller.getState().error, true); assert.equal(controller.getState().items.length, 2);
  fail = false; await controller.refresh(); assert.equal(controller.getState().error, false);
});

test('late responses cannot cross accounts or repaint after leaving Stash', async () => {
  const old = deferred<FindSourceSummaryPage>();
  const controller = createStashSourcesController(async (_kind, _cursor, owner) => owner === 'A' ? old.promise : page([row(5)]));
  controller.configure('A'); controller.setActive(true); const stale = controller.refresh();
  controller.configure('B'); assert.equal(controller.getState().items.length, 0); await controller.refresh();
  old.resolve(page([row(99)])); await stale;
  assert.deepEqual(controller.getState().items.map(item => item.id), [row(5).id]);
  controller.setActive(false); const before = controller.getState(); await controller.refresh(); assert.equal(controller.getState(), before);
});

test('duplicate refresh taps share one in-flight fetch and repeated cursors fail safely', async () => {
  const pending = deferred<FindSourceSummaryPage>(); let calls = 0;
  const controller = createStashSourcesController(async () => { calls++; return pending.promise; });
  controller.configure('A'); controller.setActive(true); const first = controller.refresh(); await controller.refresh();
  assert.equal(calls, 2, 'one request per existing endpoint'); pending.resolve(page([row(1)])); await first;
  const broken = createStashSourcesController(async (_kind, cursor) => page([row(1)], cursor ?? 'same'));
  broken.configure('A'); broken.setActive(true); await broken.refresh(); assert.equal(broken.getState().error, true);
});
