import assert from 'node:assert/strict';
import { it } from 'node:test';
import { confirmPublication, createPublishSingleFlight } from './publishSingleFlight';

it('coalesces matching double taps without blocking a different draft or account', async () => {
  const publish = createPublishSingleFlight<string>();
  let resolve!: (value: string) => void;
  let calls = 0;
  const pending = new Promise<string>((done) => { resolve = done; });
  const first = publish('owner:draft', () => { calls++; return pending; });
  const second = publish('owner:draft', async () => { calls++; return 'duplicate'; });
  assert.equal(first, second);
  assert.equal(await publish('other:draft', async () => 'independent'), 'independent');
  resolve('confirmed');
  assert.deepEqual(await Promise.all([first, second]), ['confirmed', 'confirmed']);
  assert.equal(calls, 1);
});

it('does not cache network errors or unsuccessful publish responses; retry keeps the same draft ID', async () => {
  const publish = createPublishSingleFlight<{ ok: boolean }>();
  await assert.rejects(publish('draft', async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(await publish('draft', async () => ({ ok: false })), { ok: false });
  assert.deepEqual(await publish('draft', async () => ({ ok: true })), { ok: true });
});

it('does not silently acknowledge a different selection while another publish is pending', async () => {
  const publish = createPublishSingleFlight<string>();
  let resolve!: (value: string) => void;
  const first = publish('draft', () => new Promise<string>((done) => { resolve = done; }), 'product-a');
  await assert.rejects(publish('draft', async () => 'wrong selection', 'product-b'), /another selection/);
  resolve('published-a');
  assert.equal(await first, 'published-a');
});

it('does not claim legacy rejection or incomplete finalization as publication', async () => {
  for (const status of ['rejected', 'ready_for_review', 'failed']) {
    assert.equal((await confirmPublication({ ok: true }, async () => ({ status }))).ok, false);
  }
  assert.equal((await confirmPublication({ ok: true }, async () => null)).ok, false);
  assert.deepEqual(await confirmPublication({ ok: true }, async () => ({ status: 'published', collection_id: 'existing' })),
    { ok: true, collectionId: 'existing', videoId: undefined });
});

it('ordinary backend confirmation and failure do not need a second read', async () => {
  const read = async () => assert.fail('unnecessary confirmation read');
  assert.deepEqual(await confirmPublication({ ok: true, collectionId: 'confirmed' }, read), { ok: true, collectionId: 'confirmed' });
  assert.deepEqual(await confirmPublication({ ok: false, error: 'retry' }, read), { ok: false, error: 'retry' });
});
