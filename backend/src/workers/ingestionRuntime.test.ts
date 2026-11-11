import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaimedIngest } from './ingestJobGate';
import { assertPendingJobsApproved, hasIngestConsumer, ingestionReadiness, pendingIngestionJobs,
  stoppedWorkers, validateIngestionAdmission } from './ingestionRuntime';

const now = Date.parse('2026-10-30T00:00:00Z');
const policy = { version: 1 as const, approvedAt: new Date(now).toISOString(),
  existingJobs: [{ queue: 'ingest-pipeline', id: 'ingest-existing' }] };
const info = 'loading:0\r\nrdb_last_bgsave_status:ok\r\naof_enabled:0\r\n';
const clients = `id=1 name=bull:${Buffer.from('ingest-pipeline').toString('base64')}:w:local flags=b`;
it('allows reviewed old jobs and normal post-approval traffic across a restart, without re-enqueueing', () => {
  validateIngestionAdmission(policy, now);
  const jobs = [{ queue: 'ingest-pipeline', id: 'ingest-existing', timestamp: now - 1000 },
    { queue: 'ingest-pipeline', id: 'ingest-new', timestamp: now + 1 }];
  const snapshot = structuredClone(jobs);
  assertPendingJobsApproved(jobs, policy); assertPendingJobsApproved(jobs, policy);
  assert.deepEqual(jobs, snapshot);
  assert.throws(() => assertPendingJobsApproved([{ ...jobs[0], id: 'unknown-old' }], policy), /Unreviewed/);
  assert.throws(() => assertPendingJobsApproved([{ ...jobs[0], queue: 'unrelated' }], policy), /Unreviewed/);
  assert.throws(() => assertPendingJobsApproved([{ ...jobs[0], timestamp: 0 }], policy), /Unreviewed/);
});
it('fails closed on missing, malformed, future, unknown-queue or duplicate policies', () => {
  for (const p of [null, {}, { ...policy, version: 2 }, { ...policy, approvedAt: 'invalid' },
    { ...policy, approvedAt: new Date(now + 1000).toISOString() },
    { ...policy, existingJobs: [{ queue: 'unknown', id: 'x' }] },
    { ...policy, existingJobs: [policy.existingJobs[0], policy.existingJobs[0]] }]) {
    assert.throws(() => validateIngestionAdmission(p, now));
  }
});
it('inspects pending work using only reads, keeping job IDs and all queue states intact', async () => {
  const calls: string[] = [];
  const jobs = await pendingIngestionJobs({
    lrange: async (key: string) => { calls.push(key); return key === 'bull:ingest-pipeline:wait' ? ['job'] : []; },
    zrange: async (key: string) => { calls.push(key); return []; },
    hget: async () => String(now - 1000),
  } as unknown as Parameters<typeof pendingIngestionJobs>[0]);
  assert.deepEqual(jobs, [{ queue: 'ingest-pipeline', id: 'job', timestamp: now - 1000 }]);
  assert.ok(calls.includes('bull:ingest-pipeline:active'));
  assert.ok(calls.includes('bull:product-resolve:delayed'));
  assert.ok(!calls.some(c => c.includes('notifications')));
});
it('does not confuse a Redis/API client or another queue with an ingestion worker', () => {
  assert.equal(hasIngestConsumer('id=1 name= flags=N'), false);
  assert.equal(hasIngestConsumer('id=1 name=bull:cHJvZHVjdC1yZXNvbHZl flags=b'), false);
  assert.equal(hasIngestConsumer(clients), true);
  assert.equal(hasIngestConsumer(clients.replace(':w:local', '')), true);
});
it('distinguishes liveness from consumer readiness, Redis failure and persistence failure', async () => {
  const deps = { ping: async () => 'PONG', persistence: async () => info, clients: async () => clients };
  assert.deepEqual(await ingestionReadiness(deps), { ready: true, reason: 'ready' });
  assert.equal((await ingestionReadiness({ ...deps, clients: async () => '' })).reason, 'worker_unavailable');
  assert.equal((await ingestionReadiness({ ...deps, persistence: async () => info.replace('status:ok', 'status:err') })).reason, 'redis_persistence_unhealthy');
  assert.equal((await ingestionReadiness({ ...deps, persistence: async () => info.replace('aof_enabled:0', 'aof_enabled:1\naof_last_write_status:err') })).ready, false);
  assert.equal((await ingestionReadiness({ ...deps, ping: async () => { throw new Error('Redis down'); } })).reason, 'redis_unavailable');
  assert.equal((await ingestionReadiness({ ...deps, clients: () => new Promise(() => {}) }, 5)).ready, false);
});
it('detects a stopped consumer so the supervised process can exit and recover', () => {
  const worker = { name: 'ingest-pipeline', isRunning: () => false, isPaused: () => false };
  assert.deepEqual(stoppedWorkers([worker]), ['ingest-pipeline']);
  assert.deepEqual(stoppedWorkers([{ ...worker, isRunning: () => true }]), []);
  assert.deepEqual(stoppedWorkers([{ ...worker, isPaused: () => true }]), []);
});
it('skips completed/published redeliveries and missing ingests without provider calls', async () => {
  for (const status of [null, 'published', 'rejected', 'ready_for_review', 'review_required', 'failed']) {
    const result = await runClaimedIngest('same-id', { readStatus: async () => status,
      run: async () => { throw new Error('Provider forbidden'); } });
    assert.equal(result.status, 'skipped');
  }
});
it('runs explicit processing retries with the original identity and preserves failures for BullMQ retry', async () => {
  let count = 0;
  const deps = { readStatus: async () => 'processing', run: async (id: string) => {
    assert.equal(id, 'same-id'); if (++count === 1) throw new Error('transient'); return { status: 'ready_for_review' };
  } };
  await assert.rejects(runClaimedIngest('same-id', deps), /transient/);
  assert.equal((await runClaimedIngest('same-id', deps)).status, 'ready_for_review');
  await assert.rejects(runClaimedIngest('same-id', { ...deps, readStatus: async () => { throw new Error('database unavailable'); } }), /database unavailable/);
  assert.equal(count, 2);
});
it('all workers in the shared ingestion process use reconnecting connections', () => {
  for (const file of ['workers/ingestPipelineWorker.ts', 'product-intelligence/jobs/productResolveQueue.ts',
    'ai-review/jobs/productAiReviewQueue.ts', 'creator-library/jobs/librarySyncWorker.ts', 'content-source/jobs/contentSourceWorker.ts']) {
    const text = readFileSync(join(__dirname, '..', file), 'utf8');
    assert.match(text, /duplicateBullmqWorkerRedis/);
    assert.doesNotMatch(text.slice(text.indexOf('new Worker')), /connection: getBullmqConnection\(\)(\.duplicate\(\))?/);
  }
});
