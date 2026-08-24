import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RedisOptions } from 'ioredis';
import { enqueueOnReadyQueue, type IngestPipelineJobData } from './queue';
import { buildBullmqConnectionOptions } from './redisConnection';

describe('buildBullmqConnectionOptions', () => {
  it('maps localhost to IPv4 127.0.0.1 so enqueue does not hang on ::1', () => {
    const opts = buildBullmqConnectionOptions('redis://localhost:6379') as RedisOptions;
    assert.equal(opts.host, '127.0.0.1');
    assert.equal(opts.port, 6379);
    assert.equal(opts.family, 4);
    assert.equal(opts.enableOfflineQueue, false);
    assert.equal(opts.lazyConnect, true);
    assert.equal(opts.retryStrategy?.(1), null);
  });

  it('parses password, ACL username, db, and TLS from a Redis URL', () => {
    const opts = buildBullmqConnectionOptions(
      'rediss://user:s3cret@redis.example:6380/2',
    ) as RedisOptions;
    assert.equal(opts.host, 'redis.example');
    assert.equal(opts.port, 6380);
    assert.equal(opts.username, 'user');
    assert.equal(opts.password, 's3cret');
    assert.equal(opts.db, 2);
    assert.ok(opts.tls);
  });
});

describe('enqueueOnReadyQueue', () => {
  const data: IngestPipelineJobData = { ingestRequestId: 'req-1', traceId: 'trace-1' };

  it('waits until the queue is ready before add so local enqueue does not hit the 5s timeout', async () => {
    const events: string[] = [];
    const q = {
      async waitUntilReady() {
        events.push('ready');
      },
      async add() {
        events.push('add');
        if (!events.includes('ready')) {
          throw new Error('add before ready');
        }
        return { id: 'job-1' };
      },
      async getJob() {
        return null;
      },
    };

    const id = await enqueueOnReadyQueue(q, data, {}, { status: 'connect' });
    assert.equal(id, 'job-1');
    assert.deepEqual(events, ['ready', 'add']);
  });

  it('reaches Queue.add without waitUntilReady when the command Redis client is already ready', async () => {
    let waited = false;
    const q = {
      async waitUntilReady() {
        waited = true;
        await new Promise(() => {
          /* hang — this used to be ingest.queue.ready */
        });
      },
      async add() {
        return { id: 'job-ready' };
      },
      async getJob() {
        return null;
      },
    };

    const id = await enqueueOnReadyQueue(
      q,
      data,
      { readyMs: 40, addMs: 200 },
      { status: 'ready', host: '127.0.0.1', port: 6379 },
    );
    assert.equal(id, 'job-ready');
    assert.equal(waited, false);
  });

  it('still times out add as a safety net when Redis is ready but add hangs', async () => {
    const q = {
      async waitUntilReady() {
        return;
      },
      async add() {
        return new Promise<{ id?: string }>(() => {
          /* hang */
        });
      },
      async getJob() {
        return null;
      },
    };

    await assert.rejects(
      () =>
        enqueueOnReadyQueue(q, data, { readyMs: 100, addMs: 40 }, { status: 'ready' }),
      /ingest\.enqueue timed out after 40ms/,
    );
  });
});

describe('local Redis optional fallback', () => {
  it('bypasses BullMQ when Redis is unavailable and not required', async () => {
    const { shouldBypassBullmqEnqueue, REDIS_UNAVAILABLE_ENQUEUE_ERROR } = await import(
      './redisConnection'
    );
    assert.equal(shouldBypassBullmqEnqueue(false), true);
    assert.equal(shouldBypassBullmqEnqueue(true), false);
    assert.equal(REDIS_UNAVAILABLE_ENQUEUE_ERROR, 'ingest.queue.redis_unavailable');
  });

  it('probes a closed port as unavailable without hanging', async () => {
    const { probeRedisTcp } = await import('./redisConnection');
    const start = Date.now();
    const ok = await probeRedisTcp('127.0.0.1', 1, 150);
    assert.equal(ok, false);
    assert.ok(Date.now() - start < 1_000);
  });

  it('enqueueIngestPipeline fails immediately without waitUntilReady when Redis is down', async () => {
    const { setRedisAvailabilityForTests, REDIS_UNAVAILABLE_ENQUEUE_ERROR } = await import(
      './redisConnection'
    );
    const { enqueueIngestPipeline } = await import('./queue');
    setRedisAvailabilityForTests(false);
    const start = Date.now();
    await assert.rejects(
      () => enqueueIngestPipeline({ ingestRequestId: 'req-down', traceId: 't' }),
      (err: Error) => err.message === REDIS_UNAVAILABLE_ENQUEUE_ERROR,
    );
    assert.ok(Date.now() - start < 400);
  });
});
