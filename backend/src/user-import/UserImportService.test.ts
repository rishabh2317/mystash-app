import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CatalogService } from '../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../catalog/InMemoryCatalogRepository';
import { CartService } from '../cart/CartService';
import { InMemoryCartRepository } from '../cart/InMemoryCartRepository';
import { ContentSourceService } from '../content-source/ContentSourceService';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { contentSourceProcessingJobId } from '../content-source/jobs/contentSourceQueue';
import type { ContentProcessingQueuePort } from '../content-source/ports';
import { USER_IMPORT_TIMEOUT_MS } from './domain/shareProgress';
import { InMemoryUserImportRepository } from './InMemoryUserImportRepository';
import type { UserImportBagSyncPort, UserImportContentSourcePort } from './ports';
import { UserImportService, UserImportServiceError } from './UserImportService';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const REEL_URL = 'https://www.instagram.com/reel/ABC123/';

/** Backend compiles as CommonJS, so `__dirname` is the portable choice here. */
const DOMAIN_DIR = __dirname;

type RecordedJob = { jobId: string; contentSourceId: string; userImportId: string };

function createHarness(
  options: {
    enqueue?: ContentProcessingQueuePort['enqueue'];
    repo?: InMemoryUserImportRepository;
    bagSync?: UserImportBagSyncPort | null;
    scheduleTimeout?: (userImportId: string) => Promise<void>;
    nowMs?: () => number;
  } = {},
) {
  const repo = options.repo ?? new InMemoryUserImportRepository();
  const sourceRepo = new InMemoryContentSourceRepository();
  const jobs: RecordedJob[] = [];
  const timeoutJobs: string[] = [];
  const queue: ContentProcessingQueuePort = {
    enqueue: async (data) => {
      const jobId = options.enqueue
        ? await options.enqueue(data)
        : contentSourceProcessingJobId(data.contentSourceId);
      jobs.push({ jobId, contentSourceId: data.contentSourceId, userImportId: data.userImportId });
      return jobId;
    },
  };
  const contentSource = new ContentSourceService(sourceRepo, queue);
  const port: UserImportContentSourcePort = {
    getOrCreate: (normalizedUrl) => contentSource.getOrCreate(normalizedUrl),
    getById: (id) => contentSource.getById(id),
    listProducts: (id) => contentSource.listProducts(id),
    requestProcessing: (params) => contentSource.requestProcessing(params),
    requestReprocessing: (params) => contentSource.requestReprocessing(params),
  };
  const scheduleTimeout =
    options.scheduleTimeout ??
    (async (userImportId: string) => {
      timeoutJobs.push(userImportId);
    });
  return {
    repo,
    sourceRepo,
    jobs,
    timeoutJobs,
    service: new UserImportService(
      repo,
      port,
      options.bagSync ?? null,
      scheduleTimeout,
      options.nowMs,
    ),
  };
}

describe('UserImportService', () => {
  it('accepts an authenticated submission and persists normalized + raw input', async () => {
    const { repo, service } = createHarness();
    const result = await service.submit(USER_A, {
      rawInput: `Check this out: ${REEL_URL}?utm_source=ig`,
    });

    assert.equal(result.created, true);
    assert.equal(result.record.status, 'RECEIVED');
    assert.equal(result.record.userId, USER_A);
    assert.equal(result.record.sourceUrl, `${REEL_URL}?utm_source=ig`);
    assert.equal(result.record.normalizedUrl, REEL_URL);
    assert.equal(result.record.rawInput, `Check this out: ${REEL_URL}?utm_source=ig`);
    assert.equal(result.record.platform, 'instagram');
    assert.equal(repo.imports.size, 1);
  });

  it('rejects a submission without a user id as unauthorized', async () => {
    const { service } = createHarness();
    await assert.rejects(
      () => service.submit('', { rawInput: REEL_URL }),
      (err: unknown) =>
        err instanceof UserImportServiceError && err.statusCode === 401,
    );
  });

  it('rejects invalid input with a 400 and no internal detail', async () => {
    const { repo, service } = createHarness();
    const cases: [string, string][] = [
      ['', 'url required'],
      ['no link here', 'Could not find a link in the shared text'],
      ['file:///etc/passwd', 'Only http and https links can be imported'],
      ['http://127.0.0.1/admin', 'That link cannot be imported'],
    ];

    for (const [rawInput, message] of cases) {
      await assert.rejects(
        () => service.submit(USER_A, { rawInput }),
        (err: unknown) =>
          err instanceof UserImportServiceError &&
          err.statusCode === 400 &&
          err.message === message,
      );
    }
    assert.equal(repo.imports.size, 0);
  });

  it('is idempotent for a repeated share of the same link', async () => {
    const { repo, service } = createHarness();
    const first = await service.submit(USER_A, { rawInput: REEL_URL });
    const second = await service.submit(USER_A, {
      rawInput: `again → ${REEL_URL}?igshid=abc`,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
    assert.equal(repo.imports.size, 1);
  });

  it('scopes idempotency per user', async () => {
    const { repo, service } = createHarness();
    await service.submit(USER_A, { rawInput: REEL_URL });
    const other = await service.submit(USER_B, { rawInput: REEL_URL });

    assert.equal(other.created, true);
    assert.equal(repo.imports.size, 2);
  });

  it('resolves a unique-violation race to the existing row', async () => {
    const repo = new InMemoryUserImportRepository();
    const { service } = createHarness({ repo });
    const winner = await repo.insert({
      userId: USER_A,
      rawInput: REEL_URL,
      sourceUrl: REEL_URL,
      normalizedUrl: REEL_URL,
      dedupeKey: 'seeded-key',
      platform: 'instagram',
      contentSourceId: null,
      status: 'RECEIVED',
    });
    // Force the insert path to collide even though the lookup key differs.
    const original = repo.findByUserAndDedupeKey.bind(repo);
    let lookups = 0;
    repo.findByUserAndDedupeKey = async (userId) => {
      lookups += 1;
      if (lookups === 1) return null;
      return original(userId, 'seeded-key');
    };
    repo.insert = async () => {
      const err = new Error('duplicate key value') as Error & { code?: string };
      err.code = '23505';
      throw err;
    };

    const result = await service.submit(USER_A, { rawInput: REEL_URL });
    assert.equal(result.created, false);
    assert.equal(result.record.id, winner.id);
  });

  it('surfaces a database failure instead of inventing a success', async () => {
    const repo = new InMemoryUserImportRepository();
    const { service } = createHarness({ repo });
    repo.insert = async () => {
      throw new Error('connection terminated');
    };

    await assert.rejects(() => service.submit(USER_A, { rawInput: REEL_URL }), /connection terminated/);
  });

  it('creates no canonical product and no Bag line', async () => {
    const { jobs, sourceRepo, service } = createHarness();
    const catalogRepo = new InMemoryCatalogRepository();
    const cartRepo = new InMemoryCartRepository();
    const catalog = new CatalogService(catalogRepo);
    const cart = new CartService(cartRepo, {
      resolveActiveProduct: (id) => catalog.resolveActiveProduct(id),
      getById: (id) => catalog.getById(id),
      getProductsByIds: async () => new Map(),
    });

    await service.submit(USER_A, { rawInput: REEL_URL });
    await service.submit(USER_A, { rawInput: 'https://shop.example.com/p/mug' });

    // Content sources and processing jobs exist; product and Bag state does not.
    assert.equal(sourceRepo.sources.size, 2);
    assert.equal(jobs.length, 2);
    assert.equal(catalogRepo.all().length, 0);
    assert.equal(cartRepo.items.size, 0);
    assert.deepEqual(await cart.getCart(USER_A), { items: [], itemCount: 0 });
  });

  it('does not depend on product processing, AI, catalog or cart modules', () => {
    const sources = [
      'UserImportService.ts',
      'SupabaseUserImportRepository.ts',
      'routes.ts',
      'factory.ts',
      'ports.ts',
      'domain/sharedInput.ts',
    ].map((file) => readFileSync(join(DOMAIN_DIR, file), 'utf8'));

    for (const src of sources) {
      assert.doesNotMatch(src, /product-intelligence/);
      assert.doesNotMatch(src, /ProductResolver|resolveIngestDrafts|ShoppingResolver/);
      assert.doesNotMatch(src, /catalog_products|cart_items|discovered_products/);
      assert.doesNotMatch(src, /openai|OpenAI|gemini|Gemini|tavily|Tavily/);
      // The queue handoff is delegated to Content Source, not wired in here.
      assert.doesNotMatch(src, /from 'bullmq'|BullMQ|ioredis/);
      assert.doesNotMatch(src, /\bfetch\(/);
    }
  });
});

describe('UserImportService content source relationship', () => {
  it('links an accepted import to its global content source', async () => {
    const { sourceRepo, service } = createHarness();
    const result = await service.submit(USER_A, { rawInput: REEL_URL });

    assert.ok(result.record.contentSourceId, 'import points at a content source');
    const source = await sourceRepo.findById(result.record.contentSourceId!);
    assert.equal(source?.platform, 'instagram');
    assert.equal(source?.externalId, 'ABC123');
    assert.equal(source?.mediaKind, 'VIDEO');
    assert.equal(source?.canonicalUrl, REEL_URL);
  });

  it('keeps imports user-scoped while the content source stays global', async () => {
    const { repo, sourceRepo, jobs, service } = createHarness();
    const a = await service.submit(USER_A, { rawInput: REEL_URL });
    const b = await service.submit(USER_B, { rawInput: `love this ${REEL_URL}?igshid=x` });
    const c = await service.submit(USER_C, { rawInput: 'https://instagram.com/reels/ABC123/' });

    assert.equal(repo.imports.size, 3, 'three user-scoped submissions');
    assert.equal(sourceRepo.sources.size, 1, 'one global content source');
    assert.equal(a.record.contentSourceId, b.record.contentSourceId);
    assert.equal(b.record.contentSourceId, c.record.contentSourceId);
    assert.notEqual(a.record.id, b.record.id);
    assert.equal(a.record.userId, USER_A);
    assert.equal(b.record.userId, USER_B);

    assert.equal(jobs.length, 1, 'one global processing job, not one per user');
    assert.equal(jobs[0].contentSourceId, a.record.contentSourceId);
  });

  it('creates one content source per distinct source', async () => {
    const { sourceRepo, jobs, service } = createHarness();
    await service.submit(USER_A, { rawInput: REEL_URL });
    await service.submit(USER_A, { rawInput: 'https://youtu.be/dQw4w9WgXcQ?si=abc' });
    await service.submit(USER_A, { rawInput: 'https://shop.example.com/p/mug' });

    assert.equal(sourceRepo.sources.size, 3);
    assert.equal(jobs.length, 3);
  });

  it('does not queue a second job when the same user re-shares', async () => {
    const { repo, sourceRepo, jobs, service } = createHarness();
    await service.submit(USER_A, { rawInput: REEL_URL });
    const again = await service.submit(USER_A, { rawInput: `${REEL_URL}?utm_source=ig` });

    assert.equal(again.created, false);
    assert.equal(repo.imports.size, 1);
    assert.equal(sourceRepo.sources.size, 1);
    assert.equal(jobs.length, 1);
  });

  it('enqueues a payload of stable ids only', async () => {
    const { jobs, service } = createHarness();
    const result = await service.submit(USER_A, {
      rawInput: `Check this out: ${REEL_URL}?utm_source=ig`,
    });

    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0], {
      jobId: `content-source-${result.record.contentSourceId}`,
      contentSourceId: result.record.contentSourceId,
      userImportId: result.record.id,
    });
  });

  it('accepts the share even when the enqueue fails', async () => {
    const { repo, sourceRepo, service } = createHarness({
      enqueue: async () => {
        throw new Error('redis down');
      },
    });

    const result = await service.submit(USER_A, { rawInput: REEL_URL });

    assert.equal(result.created, true);
    assert.equal(result.record.status, 'RECEIVED');
    assert.equal(repo.imports.size, 1, 'acceptance is durable regardless of the queue');
    const source = await sourceRepo.findById(result.record.contentSourceId!);
    assert.equal(source?.processingStatus, 'RECEIVED', 'left re-enqueueable');
  });

  it('re-hands off work when a user re-shares a source that was never queued', async () => {
    let failNext = true;
    const { sourceRepo, jobs, service } = createHarness({
      enqueue: async (data) => {
        if (failNext) {
          failNext = false;
          throw new Error('redis down');
        }
        return contentSourceProcessingJobId(data.contentSourceId);
      },
    });

    const first = await service.submit(USER_A, { rawInput: REEL_URL });
    assert.equal(jobs.length, 0);

    const retry = await service.submit(USER_A, { rawInput: REEL_URL });
    assert.equal(retry.created, false);
    assert.equal(retry.record.id, first.record.id);
    assert.equal(jobs.length, 1, 'the retry recovered the dropped handoff');
    const source = await sourceRepo.findById(first.record.contentSourceId!);
    assert.equal(source?.processingStatus, 'QUEUED');
  });

  it('queues nothing when input is rejected', async () => {
    const { sourceRepo, jobs, service } = createHarness();
    await assert.rejects(() => service.submit(USER_A, { rawInput: 'http://127.0.0.1/admin' }));
    await assert.rejects(() => service.submit(USER_A, { rawInput: 'no link here' }));

    assert.equal(sourceRepo.sources.size, 0);
    assert.equal(jobs.length, 0);
  });

  it('asks Bag sync to apply when a source is already resolved', async () => {
    const applied: Array<{ id: string; userId: string; contentSourceId: string | null }> = [];
    const { service } = createHarness({
      bagSync: {
        applyIfResolved: async (row) => {
          applied.push(row);
        },
      },
    });
    const first = await service.submit(USER_A, { rawInput: REEL_URL });
    const second = await service.submit(USER_B, { rawInput: REEL_URL });
    assert.equal(applied.length, 2);
    assert.equal(applied[0]?.id, first.record.id);
    assert.equal(applied[0]?.userId, USER_A);
    assert.equal(applied[0]?.contentSourceId, first.record.contentSourceId);
    assert.equal(applied[1]?.id, second.record.id);
    assert.equal(applied[1]?.userId, USER_B);
    assert.equal(applied[1]?.contentSourceId, first.record.contentSourceId);
  });

  it('lists recent share progress without queue vocabulary', async () => {
    const { service, sourceRepo } = createHarness();
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    const looking = await service.listRecent(USER_A);
    assert.equal(looking.length, 1);
    assert.equal(looking[0]?.importId, submitted.record.id);
    assert.equal(looking[0]?.state, 'looking');
    assert.equal(looking[0]?.kind, 'instagram');
    assert.equal(looking[0]?.createdAt, submitted.record.createdAt);
    assert.equal(looking[0]?.productCount, 0);
    assert.equal(looking[0]?.contentSourceId, submitted.record.contentSourceId);
    assert.equal(looking[0]?.sourceUrl, submitted.record.sourceUrl);
    assert.equal(looking[0]?.primaryProduct, null);
    assert.deepEqual(looking[0]?.products, []);

    const source = await sourceRepo.findById(submitted.record.contentSourceId!);
    assert.ok(source);
    sourceRepo.sources.set(source.id, {
      ...source,
      processingStatus: 'READY',
      candidateCount: 0,
    });
    const empty = await service.listRecent(USER_A);
    assert.equal(empty[0]?.state, 'nothing_yet');
    assert.equal(empty[0]?.productCount, 0);
    assert.equal(empty[0]?.primaryProduct, null);

    const catalogId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const discoveredId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await sourceRepo.replaceProducts(source.id, [
      {
        contentSourceId: source.id,
        position: 0,
        externalId: 'p1',
        name: 'Ceramic Mug',
        brand: null,
        model: null,
        category: null,
        price: null,
        currency: null,
        image: 'https://cdn.example.com/mug.jpg',
        merchantUrl: null,
        confidence: null,
        extractionMethod: 'ai_extract',
        sources: [],
        evidence: {},
        processorVersion: 'test',
        catalogProductId: catalogId,
        discoveredProductId: null,
      },
      {
        contentSourceId: source.id,
        position: 1,
        externalId: 'p2',
        name: 'Other',
        brand: null,
        model: null,
        category: null,
        price: null,
        currency: null,
        image: null,
        merchantUrl: null,
        confidence: null,
        extractionMethod: 'ai_extract',
        sources: [],
        evidence: {},
        processorVersion: 'test',
        catalogProductId: null,
        discoveredProductId: discoveredId,
      },
    ]);
    sourceRepo.sources.set(source.id, { ...source, processingStatus: 'READY', candidateCount: 2 });
    const ready = await service.listRecent(USER_A);
    assert.equal(ready[0]?.state, 'ready');
    assert.equal(ready[0]?.productCount, 2);
    assert.deepEqual(ready[0]?.primaryProduct, {
      productId: catalogId,
      title: 'Ceramic Mug',
      imageUrl: 'https://cdn.example.com/mug.jpg',
    });

    sourceRepo.sources.set(source.id, { ...source, processingStatus: 'FAILED', candidateCount: 0 });
    assert.equal((await service.listRecent(USER_A))[0]?.state, 'couldnt_finish');
  });

  it('uses discovered product id when catalog id is absent', async () => {
    const { service, sourceRepo } = createHarness();
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    const source = await sourceRepo.findById(submitted.record.contentSourceId!);
    assert.ok(source);
    const discoveredId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await sourceRepo.replaceProducts(source.id, [
      {
        contentSourceId: source.id,
        position: 0,
        externalId: 'p1',
        name: 'Discovered Only',
        brand: null,
        model: null,
        category: null,
        price: null,
        currency: null,
        image: null,
        merchantUrl: null,
        confidence: null,
        extractionMethod: 'ai_extract',
        sources: [],
        evidence: {},
        processorVersion: 'test',
        catalogProductId: null,
        discoveredProductId: discoveredId,
      },
    ]);
    sourceRepo.sources.set(source.id, { ...source, processingStatus: 'READY', candidateCount: 1 });
    const items = await service.listRecent(USER_A);
    assert.equal(items[0]?.primaryProduct?.productId, discoveredId);
    assert.equal(items[0]?.productCount, 1);
  });

  it('retries a timed-out import without creating a second submission', async () => {
    const { service, repo, jobs, sourceRepo } = createHarness();
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    await repo.markTimedOut(submitted.record.id, new Date().toISOString());
    assert.equal((await service.listRecent(USER_A))[0]?.state, 'couldnt_finish');

    const beforeJobs = jobs.length;
    const retried = await service.retry(USER_A, submitted.record.id);
    assert.equal(retried.id, submitted.record.id);
    assert.equal(repo.imports.size, 1);
    assert.equal(repo.imports.get(submitted.record.id)?.timedOutAt, null);
    assert.ok(jobs.length >= beforeJobs);
    assert.equal((await service.listRecent(USER_A))[0]?.state, 'looking');

    // READY late path: bag sync is idempotent — still one import row.
    const source = await sourceRepo.findById(submitted.record.contentSourceId!);
    assert.ok(source);
    sourceRepo.sources.set(source.id, { ...source, processingStatus: 'READY', candidateCount: 1 });
    await service.retry(USER_A, submitted.record.id);
    assert.equal(repo.imports.size, 1);
  });

  it('deletes only the user import row', async () => {
    const { service, repo, sourceRepo } = createHarness();
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    const sourceId = submitted.record.contentSourceId!;
    await service.delete(USER_A, submitted.record.id);
    assert.equal(repo.imports.size, 0);
    assert.ok(await sourceRepo.findById(sourceId));
    assert.equal((await service.listRecent(USER_A)).length, 0);
  });

  it('enqueues content-source processing on submit', async () => {
    const { service, jobs, timeoutJobs } = createHarness();
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.contentSourceId, submitted.record.contentSourceId);
    assert.equal(jobs[0]?.userImportId, submitted.record.id);
    assert.deepEqual(timeoutJobs, [submitted.record.id]);
  });

  it('times out looking imports after 10 minutes via listRecent self-heal', async () => {
    const createdAt = '2026-09-22T10:00:00.000Z';
    let nowMs = Date.parse(createdAt) + 1000;
    const { service, repo, sourceRepo } = createHarness({
      nowMs: () => nowMs,
    });
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    // Pin createdAt for age calculation.
    const row = repo.imports.get(submitted.record.id)!;
    repo.imports.set(submitted.record.id, { ...row, createdAt });

    assert.equal((await service.listRecent(USER_A))[0]?.state, 'looking');

    nowMs = Date.parse(createdAt) + USER_IMPORT_TIMEOUT_MS;
    const timedOut = await service.listRecent(USER_A);
    assert.equal(timedOut[0]?.state, 'couldnt_finish');
    assert.ok(repo.imports.get(submitted.record.id)?.timedOutAt);

    // Late READY must not resurrect the timed-out import.
    const source = await sourceRepo.findById(submitted.record.contentSourceId!);
    assert.ok(source);
    sourceRepo.sources.set(source.id, {
      ...source,
      processingStatus: 'READY',
      candidateCount: 2,
    });
    assert.equal((await service.listRecent(USER_A))[0]?.state, 'couldnt_finish');
  });

  it('applyTimeout freezes looking imports without mutating content_sources', async () => {
    const { service, repo, sourceRepo } = createHarness();
    const submitted = await service.submit(USER_A, { rawInput: REEL_URL });
    const before = await sourceRepo.findById(submitted.record.contentSourceId!);
    assert.ok(before);
    assert.equal(before.processingStatus, 'QUEUED');

    const applied = await service.applyTimeout(submitted.record.id);
    assert.equal(applied, true);
    assert.ok(repo.imports.get(submitted.record.id)?.timedOutAt);
    assert.equal(
      (await sourceRepo.findById(submitted.record.contentSourceId!))?.processingStatus,
      'QUEUED',
    );
    assert.equal((await service.listRecent(USER_A))[0]?.state, 'couldnt_finish');

    // Late worker READY still does not resurrect.
    sourceRepo.sources.set(before.id, {
      ...before,
      processingStatus: 'READY',
      candidateCount: 1,
    });
    assert.equal((await service.listRecent(USER_A))[0]?.state, 'couldnt_finish');
    assert.equal(await service.applyTimeout(submitted.record.id), false);
  });
});
