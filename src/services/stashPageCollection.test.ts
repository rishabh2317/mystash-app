import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectStashPages } from './stashPageCollection';
import { filterRecentStash } from '../ui/stashFilters';

it('includes matches from later cursor pages before filtering and keeps overlapping identities once', async () => {
  const calls: (string | undefined)[] = [];
  const items = await collectStashPages(async cursor => {
    calls.push(cursor);
    if (!cursor) return { items: [{ id: 'new', addedAt: '2026-10-30', category: 'tech' }], nextCursor: 'next' };
    return { items: [{ id: 'new', addedAt: '2026-10-30', category: 'tech' }, { id: 'old', addedAt: '2026-10-20', category: 'fashion' }], nextCursor: null };
  }, i => i.id);
  assert.deepEqual(calls, [undefined, 'next']); assert.equal(items.length, 2);
  assert.deepEqual(filterRecentStash(items, 'fashion', i => i.category).map(i => i.id), ['old']);
});

it('retains the legacy full-list response without making extra requests', async () => {
  let calls = 0;
  assert.deepEqual(await collectStashPages(async () => { calls++; return { items: ['a', 'b'] }; }, i => i), ['a', 'b']);
  assert.equal(calls, 1);
});

it('rejects failed or repeated pages instead of silently returning an incomplete dataset', async () => {
  await assert.rejects(collectStashPages(async cursor => {
    if (cursor) throw new Error('offline');
    return { items: ['first'], nextCursor: 'next' };
  }, i => i), /offline/);
  await assert.rejects(collectStashPages(async () => ({ items: ['first'], nextCursor: 'same' }), i => i), /did not advance/);
});

it('stops before reading another page after refresh/account switch invalidates the request', async () => {
  let current = true, calls = 0;
  await assert.rejects(collectStashPages(async () => {
    calls++; current = false; return { items: ['old-account'], nextCursor: 'next' };
  }, i => i, () => current), /superseded/);
  assert.equal(calls, 1);
});
