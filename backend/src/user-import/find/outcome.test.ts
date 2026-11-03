import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectFindOutcome, type FindMembershipSnapshot } from './outcome';
const source = { processingStatus: 'READY' as const, mediaKind: 'VIDEO' as const, queuedAt: null };
const progress = { attemptId: 'attempt', startedAt: '2026-11-03T00:00:00Z', finishedAt: '2026-11-03T00:01:00Z',
  extractionVersion: 'fixture', products: 'complete' as const, places: 'complete' as const, evidenceComplete: true };
const base: FindMembershipSnapshot = { foundProducts: 1, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0, savedProducts: 1, savedPlaces: 0, missingProducts: 0, missingPlaces: 0,
  snapshot: { source, progress, syncState: 'complete', syncAttemptId: progress.attemptId, startedAt: progress.startedAt } };
test('discovery counts and current saved counts remain distinct after removal', () => {
  const value = projectFindOutcome(base);
  assert.equal(value.category, 'completed'); assert.equal(value.foundProducts, 1); assert.equal(value.finishedAt, progress.finishedAt);
  const removed = projectFindOutcome({ ...base, savedProducts: 0 });
  assert.equal(removed.category, 'completed'); assert.equal(removed.foundProducts, 1); assert.equal(removed.savedProducts, 0);
});
test('partial branch failure retains results and permits extraction retry', () => {
  const value = projectFindOutcome({ ...base, snapshot: { ...base.snapshot, progress: { ...progress, places: 'failed' } } });
  assert.equal(value.category, 'attention'); assert.equal(value.result, 'partial'); assert.equal(value.canRetryExtraction, true);
});
test('empty completion and failed extraction remain distinct', () => {
  const empty = { ...base, foundProducts: 0, savedProducts: 0 };
  assert.equal(projectFindOutcome(empty).result, 'empty');
  const failed = projectFindOutcome({ ...empty, snapshot: { ...base.snapshot, source: { ...source, processingStatus: 'FAILED' },
    progress: { ...progress, products: 'failed', places: 'failed' } } });
  assert.equal(failed.result, 'failed');
});
test('delayed active work cannot be retried and late completion wins without a persisted timeout', () => {
  const running = { ...base, snapshot: { ...base.snapshot, source: { ...source, processingStatus: 'PROCESSING' as const },
    progress: { ...progress, places: 'running' as const } } };
  const delayed = projectFindOutcome(running, Date.parse(progress.startedAt) + 600_000);
  assert.equal(delayed.category, 'attention'); assert.equal(delayed.delayed, true); assert.equal(delayed.canRetryExtraction, false);
  const done = projectFindOutcome(base, Date.parse(progress.startedAt) + 900_000);
  assert.equal(done.delayed, false); assert.equal(done.category, 'completed');
});
test('missing memberships, failed saves and stale acknowledgements cannot report completion', () => {
  assert.equal(projectFindOutcome({ ...base, missingProducts: 1 }).canRetrySaving, true);
  assert.equal(projectFindOutcome({ ...base, snapshot: { ...base.snapshot, syncAttemptId: 'old' } }).category, 'processing');
  assert.equal(projectFindOutcome({ ...base, snapshot: { ...base.snapshot, syncState: 'failed' } }).category, 'attention');
});
test('incomplete historical rows are isolated and never trigger automatic backfill', () => {
  const value = projectFindOutcome({ ...base, snapshot: { ...base.snapshot, syncState: null } });
  assert.equal(value.stashSync, 'unavailable'); assert.equal(value.category, 'attention'); assert.equal(value.canRetrySaving, false);
});
test('requeued work ignores stale branch completion and resets its delay clock', () => {
  const value = projectFindOutcome({ ...base, snapshot: { ...base.snapshot,
    source: { ...source, processingStatus: 'QUEUED', queuedAt: '2026-11-03T01:00:00Z' } } }, Date.parse('2026-11-03T01:01:00Z'));
  assert.equal(value.products, 'running'); assert.equal(value.finishedAt, null); assert.equal(value.delayed, false);
  const web = projectFindOutcome({ ...base, snapshot: { ...base.snapshot, progress: null, source: { ...source, mediaKind: 'WEB_PAGE' } } });
  assert.equal(web.places, 'complete'); assert.equal(web.category, 'completed');
});
