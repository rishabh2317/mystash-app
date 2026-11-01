import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { freeTestFrameThreads, withFreeTestExtractionSlot } from './freeTestBudget';

const original = process.env.MYSTASH_RENDER_FREE_TEST;
afterEach(() => {
  if (original === undefined) delete process.env.MYSTASH_RENDER_FREE_TEST;
  else process.env.MYSTASH_RENDER_FREE_TEST = original;
});

it('preserves existing parallel behavior and FFmpeg defaults without explicit testing opt-in', async () => {
  delete process.env.MYSTASH_RENDER_FREE_TEST;
  assert.deepEqual(freeTestFrameThreads(), []);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = withFreeTestExtractionSlot(() => held);
  assert.equal(await withFreeTestExtractionSlot(async () => 2), 2);
  release(); await first;
});

it('serializes separate extraction consumers in FIFO order and releases after a failure', async () => {
  process.env.MYSTASH_RENDER_FREE_TEST = 'true';
  assert.deepEqual(freeTestFrameThreads(), ['-threads', '1']);
  const events: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = withFreeTestExtractionSlot(async () => {
    events.push('creator'); await held; throw new Error('provider failure');
  });
  const rejected = assert.rejects(first, /provider failure/);
  const second = withFreeTestExtractionSlot(async () => { events.push('import'); return 2; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['creator']);
  release(); await rejected;
  assert.equal(await second, 2);
  assert.deepEqual(events, ['creator', 'import']);
});
