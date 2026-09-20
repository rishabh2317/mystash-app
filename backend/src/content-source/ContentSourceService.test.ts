import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REDIS_UNAVAILABLE_ENQUEUE_ERROR } from '../workers/redisConnection';
import { ContentSourceService } from './ContentSourceService';
import { contentSourceProcessingJobId } from './jobs/contentSourceQueue';
import { InMemoryContentSourceRepository } from './InMemoryContentSourceRepository';
import type { ContentProcessingQueuePort } from './ports';

const IMPORT_A = '11111111-1111-4111-8111-111111111111';
const IMPORT_B = '22222222-2222-4222-8222-222222222222';

type RecordedJob = { contentSourceId: string; userImportId: string };

function createHarness(
  options: { enqueue?: ContentProcessingQueuePort['enqueue'] } = {},
) {
  const repo = new InMemoryContentSourceRepository();
  const jobs: RecordedJob[] = [];
  const queue: ContentProcessingQueuePort = {
    enqueue:
      options.enqueue ??
      (async (data) => {
        jobs.push({ contentSourceId: data.contentSourceId, userImportId: data.userImportId });
        return contentSourceProcessingJobId(data.contentSourceId);
      }),
  };
  return { repo, jobs, service: new ContentSourceService(repo, queue) };
}

describe('ContentSourceService get-or-create', () => {
  it('creates once and reuses for the same YouTube identity', async () => {
    const { repo, service } = createHarness();
    const first = await service.getOrCreate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const second = await service.getOrCreate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
    assert.equal(first.record.processingStatus, 'RECEIVED');
    assert.ok(first.record.pipelineVersion.length > 0);
    assert.equal(repo.sources.size, 1);
  });

  it('collapses equivalent canonical URLs onto one content source', async () => {
    const { repo, service } = createHarness();
    const shorts = await service.getOrCreate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // normalizeSharedInput yields the same canonical URL for youtu.be / shorts forms.
    const again = await service.getOrCreate('https://youtu.be/dQw4w9WgXcQ?si=abc');

    assert.equal(again.record.id, shorts.record.id);
    assert.equal(repo.sources.size, 1);
  });

  it('deduplicates Instagram identities', async () => {
    const { repo, service } = createHarness();
    const a = await service.getOrCreate('https://www.instagram.com/reel/ABC123/');
    const b = await service.getOrCreate('https://www.instagram.com/p/ABC123/');

    assert.equal(b.record.id, a.record.id);
    assert.equal(b.created, false);
    assert.equal(repo.sources.size, 1);
  });

  it('deduplicates product URLs through canonicalization', async () => {
    const { repo, service } = createHarness();
    const a = await service.getOrCreate('https://shop.example.com/p/mug');
    const b = await service.getOrCreate('https://shop.example.com/p/mug?utm_source=ig');

    assert.equal(b.record.id, a.record.id);
    assert.equal(repo.sources.size, 1);
  });

  it('keeps distinct sources separate', async () => {
    const { repo, service } = createHarness();
    await service.getOrCreate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await service.getOrCreate('https://www.instagram.com/reel/ABC123/');
    await service.getOrCreate('https://shop.example.com/p/mug');

    assert.equal(repo.sources.size, 3);
  });

  it('resolves a uniqueness race to the winning row', async () => {
    const repo = new InMemoryContentSourceRepository();
    const service = new ContentSourceService(repo, { enqueue: async () => 'job' });

    const winner = await repo.insert({
      platform: 'youtube',
      externalId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mediaKind: 'VIDEO',
      processingStatus: 'RECEIVED',
      pipelineVersion: 'test',
    });

    // Simulate the loser: lookup misses, then the DB rejects the insert.
    let lookups = 0;
    const findByIdentity = repo.findByIdentity.bind(repo);
    repo.findByIdentity = async (identity) => {
      lookups += 1;
      return lookups === 1 ? null : findByIdentity(identity);
    };

    const result = await service.getOrCreate('https://youtu.be/dQw4w9WgXcQ');
    assert.equal(result.created, false);
    assert.equal(result.record.id, winner.id);
    assert.equal(repo.sources.size, 1);
  });

  it('propagates a non-uniqueness database failure', async () => {
    const repo = new InMemoryContentSourceRepository();
    const service = new ContentSourceService(repo, { enqueue: async () => 'job' });
    repo.insert = async () => {
      throw new Error('connection terminated unexpectedly');
    };

    await assert.rejects(
      () => service.getOrCreate('https://shop.example.com/p/mug'),
      /connection terminated/,
    );
  });
});

describe('ContentSourceService processing handoff', () => {
  it('queues global work once and marks the source QUEUED', async () => {
    const { repo, jobs, service } = createHarness();
    const source = await service.getOrCreate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const result = await service.requestProcessing({
      contentSource: source.record,
      userImportId: IMPORT_A,
    });

    assert.deepEqual(result, {
      queued: true,
      suppressed: false,
      enqueueFailed: false,
      jobId: `content-source-${source.record.id}`,
    });
    assert.deepEqual(jobs, [{ contentSourceId: source.record.id, userImportId: IMPORT_A }]);
    const stored = await repo.findById(source.record.id);
    assert.equal(stored?.processingStatus, 'QUEUED');
    assert.ok(stored?.queuedAt);
  });

  it('suppresses duplicate global work for a second sharer', async () => {
    const { repo, jobs, service } = createHarness();
    const first = await service.getOrCreate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await service.requestProcessing({
      contentSource: first.record,
      userImportId: IMPORT_A,
    });

    const second = await service.getOrCreate('https://youtu.be/dQw4w9WgXcQ?si=abc');
    const result = await service.requestProcessing({
      contentSource: second.record,
      userImportId: IMPORT_B,
    });

    assert.equal(result.suppressed, true);
    assert.equal(result.queued, false);
    assert.equal(jobs.length, 1, 'one global processing job for one content source');
    assert.equal(repo.sources.size, 1);
  });

  it('records an enqueue failure and leaves the source re-enqueueable', async () => {
    const { repo, service } = createHarness({
      enqueue: async () => {
        throw new Error('queue exploded');
      },
    });
    const source = await service.getOrCreate('https://shop.example.com/p/mug');

    const result = await service.requestProcessing({
      contentSource: source.record,
      userImportId: IMPORT_A,
    });

    assert.deepEqual(result, {
      queued: false,
      suppressed: false,
      enqueueFailed: true,
      jobId: null,
    });
    const stored = await repo.findById(source.record.id);
    assert.equal(stored?.processingStatus, 'RECEIVED');
    assert.equal(stored?.queuedAt, null);
  });

  it('treats Redis being unavailable as a recoverable enqueue failure', async () => {
    const { repo, service } = createHarness({
      enqueue: async () => {
        throw new Error(REDIS_UNAVAILABLE_ENQUEUE_ERROR);
      },
    });
    const source = await service.getOrCreate('https://shop.example.com/p/mug');

    const result = await service.requestProcessing({
      contentSource: source.record,
      userImportId: IMPORT_A,
    });

    assert.equal(result.enqueueFailed, true);
    // RECEIVED is the durable re-enqueue signal — no inline processing exists in Phase 2.
    assert.equal((await repo.findById(source.record.id))?.processingStatus, 'RECEIVED');
  });

  it('re-enqueues a source whose earlier enqueue failed', async () => {
    let failNext = true;
    const { repo, jobs, service } = createHarness({
      enqueue: async (data) => {
        if (failNext) {
          failNext = false;
          throw new Error('transient');
        }
        return contentSourceProcessingJobId(data.contentSourceId);
      },
    });

    const source = await service.getOrCreate('https://shop.example.com/p/mug');
    await service.requestProcessing({ contentSource: source.record, userImportId: IMPORT_A });
    assert.equal(jobs.length, 0);

    const reread = await repo.findById(source.record.id);
    assert.ok(reread);
    const retry = await service.requestProcessing({
      contentSource: reread,
      userImportId: IMPORT_B,
    });

    assert.equal(retry.queued, true);
    assert.equal((await repo.findById(source.record.id))?.processingStatus, 'QUEUED');
  });

  it('stays consistent when a concurrent writer wins the QUEUED transition', async () => {
    const { jobs, repo, service } = createHarness();
    const source = await service.getOrCreate('https://shop.example.com/p/mug');
    // Another process already moved the row on between enqueue and compare-and-set.
    repo.markQueued = async () => null;

    const result = await service.requestProcessing({
      contentSource: source.record,
      userImportId: IMPORT_A,
    });

    assert.equal(result.queued, true);
    assert.equal(jobs.length, 1, 'BullMQ collapses both attempts onto one job id');
  });
});

describe('ContentSourceService scope', () => {
  it('does not run product processing, AI, catalog or Bag writes', () => {
    const sources = [
      'ContentSourceService.ts',
      'SupabaseContentSourceRepository.ts',
      'factory.ts',
      'domain/lifecycle.ts',
    ].map((file) => readFileSync(join(__dirname, file), 'utf8'));

    for (const src of sources) {
      assert.doesNotMatch(src, /product-intelligence/);
      assert.doesNotMatch(src, /ProductResolver|resolveIngestDrafts|ShoppingResolver/);
      assert.doesNotMatch(src, /catalog_products|cart_items|discovered_products/);
      assert.doesNotMatch(src, /openai|OpenAI|gemini|Gemini|tavily|Tavily/);
      assert.doesNotMatch(src, /extractionCache|getVideoExtractionCache|setVideoExtractionCache/);
      assert.doesNotMatch(src, /\bfetch\(/);
    }

    // Identity maps onto the cache key shape; it must not import the cache module itself.
    const identity = readFileSync(join(__dirname, 'domain/identity.ts'), 'utf8');
    assert.doesNotMatch(identity, /from ['"].*extractionCache['"]/);
  });
});
