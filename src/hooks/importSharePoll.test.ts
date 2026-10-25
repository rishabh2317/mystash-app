import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createImportSharePoller, IMPORT_SHARE_POLL_MS } from './importSharePoll';
import { bagHasInFlightShares } from '../ui/bag';

function clock() {
  let now = 0;
  let nextId = 1;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  return {
    schedule(fn: () => void, ms: number) {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    cancel(handle: unknown) {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at);
      for (const timer of due) {
        const index = timers.indexOf(timer);
        if (index < 0) continue;
        timers.splice(index, 1);
        timer.fn();
      }
    },
    pending() {
      return timers.length;
    },
  };
}

function poller(timers = clock()) {
  let ticks = 0;
  const poll = createImportSharePoller({
    intervalMs: IMPORT_SHARE_POLL_MS,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  poll.setOnTick(() => {
    ticks += 1;
  });
  poll.focus();
  return { poll, timers, ticks: () => ticks };
}

describe('import share poll lifecycle', () => {
  it('polls about every 1–2 seconds while a share is in flight', () => {
    assert.ok(IMPORT_SHARE_POLL_MS >= 1000);
    assert.ok(IMPORT_SHARE_POLL_MS <= 2000);
    const harness = poller();
    const gen = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(gen, true), 'poll');
    assert.equal(harness.timers.pending(), 1);
    harness.timers.advance(IMPORT_SHARE_POLL_MS);
    assert.equal(harness.ticks(), 1);
    assert.equal(harness.timers.pending(), 0);
  });

  it('keeps a single timer when several imports are looking', () => {
    const harness = poller();
    const first = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(first, true), 'poll');
    const second = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(second, true), 'poll');
    assert.equal(harness.timers.pending(), 1);
  });

  it('restarts after a focused submit once the previous poll had stopped', () => {
    const harness = poller();
    const idle = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(idle, false), 'stop');
    assert.equal(harness.timers.pending(), 0);
    const submitted = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(submitted, true), 'poll');
    assert.equal(harness.timers.pending(), 1);
  });

  it('stops when the share is no longer looking, including a stale older fetch', () => {
    const harness = poller();
    const done = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(done, false), 'stop');
    assert.equal(harness.timers.pending(), 0);
    const older = harness.poll.beginFetch();
    const newer = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(older, false), 'ignore');
    assert.equal(harness.poll.finishFetch(newer, true), 'poll');
    assert.equal(harness.timers.pending(), 1);
  });

  it('cancels the timer when the screen blurs and does not resume from an in-flight fetch', () => {
    const harness = poller();
    const gen = harness.poll.beginFetch();
    assert.equal(harness.poll.finishFetch(gen, true), 'poll');
    harness.poll.blur();
    assert.equal(harness.timers.pending(), 0);
    assert.equal(harness.poll.finishFetch(gen, true), 'ignore');
    assert.equal(harness.timers.pending(), 0);
    harness.timers.advance(IMPORT_SHARE_POLL_MS);
    assert.equal(harness.ticks(), 0);
  });

  it('treats ready, nothing yet, and failed as terminal', () => {
    assert.equal(bagHasInFlightShares([{ importId: 'a', state: 'looking', kind: 'web' }]), true);
    assert.equal(
      bagHasInFlightShares([
        { importId: 'a', state: 'ready', kind: 'web' },
        { importId: 'b', state: 'nothing_yet', kind: 'youtube' },
        { importId: 'c', state: 'couldnt_finish', kind: 'instagram' },
      ]),
      false,
    );
  });

  it('wires Search refresh into the same poller and clears it on blur', () => {
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useImportSharesPoll.ts'), 'utf8');
    const search = readFileSync(join(process.cwd(), 'app/(tabs)/search.tsx'), 'utf8');
    assert.match(hook, /createImportSharePoller/);
    assert.match(hook, /poller\.blur\(\)/);
    assert.match(hook, /finishFetch/);
    assert.match(hook, /bagHasInFlightShares/);
    assert.match(search, /refreshShares\(\)/);
    assert.match(search, /useImportSharesPoll/);
    assert.doesNotMatch(hook, /supabase\.channel|WebSocket|new QueryClient|zustand/i);
  });
});
