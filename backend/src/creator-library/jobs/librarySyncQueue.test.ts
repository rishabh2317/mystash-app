import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Job, type JobJson } from 'bullmq';
import { librarySyncJobId, type CreatorLibrarySyncJobData } from './librarySyncQueue';

const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_STARTED_AT = '2026-03-01T00:00:00.000Z';

function jobData(pageToken: string | null, userId = 'user-a'): CreatorLibrarySyncJobData {
  return {
    userId,
    connectedAccountId: ACCOUNT_ID,
    runStartedAt: RUN_STARTED_AT,
    pageToken,
    uploadsPlaylistId: pageToken ? 'UU1' : null,
  };
}

/**
 * Runs BullMQ's installed custom-id check. Constructing `Job` needs a queue,
 * and `validateOptions` only reads `opts`, so the prototype call is enough.
 */
function assertBullmqAccepts(jobId: string): void {
  const job = Object.create(Job.prototype) as {
    opts: { jobId: string };
    name: string;
    validateOptions(jobData: JobJson): void;
  };
  job.opts = { jobId };
  job.name = 'sync';
  job.validateOptions({ data: '{}' } as JobJson);
}

describe('creator library sync job id', () => {
  it('passes BullMQ custom id validation for an ISO run timestamp', () => {
    const jobId = librarySyncJobId(jobData(null));
    const legacy = `library-sync:${ACCOUNT_ID}:${RUN_STARTED_AT}:start`;

    assert.equal(jobId, `library-sync-${ACCOUNT_ID}-2026-03-01T00-00-00.000Z-start`);
    assert.doesNotMatch(jobId, /:/);
    assertBullmqAccepts(jobId);
    assert.throws(() => assertBullmqAccepts(legacy), /Custom Id cannot contain :/);
  });

  it('keeps retries idempotent and continuation pages distinct', () => {
    const start = librarySyncJobId(jobData(null));
    const retry = librarySyncJobId(jobData(null, 'user-b'));
    const continuation = librarySyncJobId(jobData('CAUQAA'));
    const samePage = librarySyncJobId(jobData('CAUQAA', 'user-b'));

    assert.equal(start, retry);
    assert.notEqual(start, continuation);
    assert.equal(continuation, samePage);
    assert.match(start, /2026-03-01T00-00-00\.000Z-start$/);
    assert.match(continuation, /2026-03-01T00-00-00\.000Z-CAUQAA$/);
    assertBullmqAccepts(continuation);
  });

  it('removes colons from the page token segment without lengthening the prefix', () => {
    const token = `abc:def${'x'.repeat(30)}`;
    const jobId = librarySyncJobId(jobData(token));
    assert.match(jobId, /-abc-defxxxxxxxxxxxxxxxxx$/);
    assert.doesNotMatch(jobId, /:/);
    assertBullmqAccepts(jobId);
  });
});
