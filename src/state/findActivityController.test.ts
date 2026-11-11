import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFindActivityController } from './findActivityController';
import { findFixture } from '../ui/findTestFixtures';
import type { FindItem } from '../services/findClient';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  let rows: FindItem[] = [], owner = 'A';
  let wait: Promise<void> | null = null;
  const reads: string[] = [], scheduled: { fn: () => void; ms: number }[] = [];
  const controller = createFindActivityController({
    async list(options) {
      reads.push(options?.filter ?? 'all');
      const items = rows.filter(row => row.outcome.category === options?.filter).slice(0, 1), ownerId = owner;
      if (wait) await wait;
      return { items, ownerId, nextCursor: null, counts: { all: rows.length, processing: 0, completed: 0, attention: 0, saved: 0 } };
    },
    async batch(ids) {
      const items = rows.filter(row => ids.includes(row.id));
      if (wait) await wait;
      return { items, unavailableIds: ids.filter(id => !items.some(row => row.id === id)) };
    },
  }, { schedule(fn, ms) { const task = { fn, ms }; scheduled.push(task); return task; }, cancel(handle) { const i = scheduled.indexOf(handle as typeof scheduled[number]); if (i >= 0) scheduled.splice(i, 1); } });
  controller.configure(owner);
  return { controller, reads, scheduled, rows(value: FindItem[]) { rows = value; }, account(value: string) { owner = value; controller.configure(value); }, defer() { let resolve!: () => void; wait = new Promise<void>(r => { resolve = r; }); return () => { wait = null; resolve(); }; } };
}
test('receipt appears synchronously even during a stale history read', async () => {
  const f = setup(), release = f.defer();
  f.rows([findFixture(3, 'attention')]); f.controller.setActive(true);
  const accepted = findFixture(1, 'processing');
  f.rows([accepted]);
  f.controller.received({ owner: 'A', id: accepted.id, created: true, sourceUrl: accepted.sourceUrl! });
  assert.equal(f.controller.getState().item?.id, accepted.id);
  assert.equal(f.controller.getState().item?.outcome.extractionActive, true);
  release(); await flush();
  assert.equal(f.controller.getState().item?.id, accepted.id);
  assert.equal(f.scheduled[0].ms, 3000);
  f.controller.setActive(false);
});
test('tracked work stays visible through completion rather than changing to attention or older work', async () => {
  const f = setup(), active = findFixture(1, 'processing'), attention = findFixture(3, 'attention'), older = findFixture(5, 'processing');
  f.rows([active, older, attention]); f.controller.setActive(true); await flush();
  assert.equal(f.controller.getState().item?.id, active.id);
  const done = { ...active, outcome: findFixture(1).outcome };
  f.rows([done, older, attention]); await f.controller.refresh();
  assert.equal(f.controller.getState().item?.id, active.id);
  assert.equal(f.controller.getState().item?.outcome.category, 'completed');
  assert.equal(f.scheduled[0].ms, 20000);
  const newest = findFixture(0, 'processing');
  f.rows([newest, done, older, attention]); await f.controller.refresh();
  assert.equal(f.controller.getState().item?.id, newest.id);
  f.controller.setActive(false);
});
test('account changes clear activity and fence late requests and receipt events', async () => {
  const f = setup(), release = f.defer();
  f.rows([findFixture(1, 'processing')]); f.controller.setActive(true);
  f.rows([]); f.account('B');
  f.controller.received({ owner: 'A', id: findFixture(2).id, created: true, sourceUrl: 'https://example.com' });
  assert.equal(f.controller.getState().item, null);
  release(); await flush();
  assert.deepEqual(f.controller.getState(), { owner: 'B', item: null });
  f.controller.setActive(false); assert.equal(f.scheduled.length, 0);
});
test('removed tracked Finds are cleared on refresh', async () => {
  const f = setup(); f.rows([findFixture(1, 'processing')]); f.controller.setActive(true); await flush();
  f.rows([]); await f.controller.refresh(); assert.equal(f.controller.getState().item, null);
  f.controller.setActive(false);
});
test('an already captured link opens its real state instead of flashing as new processing', async () => {
  const f = setup(), old = findFixture(3, 'attention'), existing = findFixture(1);
  f.rows([old, existing]); f.controller.setActive(true); await flush();
  assert.equal(f.controller.getState().item?.id, old.id);
  f.controller.received({ owner: 'A', id: existing.id, created: false, sourceUrl: existing.sourceUrl! });
  assert.equal(f.controller.getState().item?.outcome.extractionActive, false);
  await flush();
  assert.equal(f.controller.getState().item?.id, existing.id);
  assert.equal(f.controller.getState().item?.outcome.category, 'completed');
  f.controller.setActive(false);
});
