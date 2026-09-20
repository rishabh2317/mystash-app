import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { InMemoryContentSourceRepository } from '../InMemoryContentSourceRepository';
import { InMemoryUserImportRepository } from '../../user-import/InMemoryUserImportRepository';
import type { ContentSourceRecord, VideoExtractionPortResult, WebEnrichmentPortResult } from '../domain/types';
import type { UserImportLookupPort, VideoExtractionPort, WebEnrichmentPort, ContentSourceResolutionPort } from '../ports';
import { ContentSourceTerminalError } from './errors';
import { ContentSourceProcessor } from './ContentSourceProcessor';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IMPORT_A = '11111111-1111-4111-8111-111111111111';
const IMPORT_B = '22222222-2222-4222-8222-222222222222';
const TRACE = 'trace-phase-3';

type VideoFn = VideoExtractionPort['extract'];
type WebFn = WebEnrichmentPort['enrich'];

function videoResult(
  partial: Partial<VideoExtractionPortResult> & { products?: VideoExtractionPortResult['products'] },
): VideoExtractionPortResult {
  const products = partial.products ?? [];
  return {
    products,
    cacheHit: partial.cacheHit ?? false,
    empty: partial.empty ?? products.length === 0,
    finalStage: partial.finalStage ?? 'stage1',
    extractionMethod: partial.extractionMethod ?? (partial.cacheHit ? 'cache' : 'ai_extract'),
  };
}

async function insertQueued(
  repo: InMemoryContentSourceRepository,
  kind: 'VIDEO' | 'WEB_PAGE',
): Promise<ContentSourceRecord> {
  return repo.insert({
    platform: kind === 'VIDEO' ? 'youtube' : 'web',
    externalId: kind === 'VIDEO' ? 'dQw4w9WgXcQ' : 'm_webmug000000000000000000000',
    canonicalUrl:
      kind === 'VIDEO'
        ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        : 'https://shop.example.com/p/mug',
    mediaKind: kind,
    processingStatus: 'QUEUED',
    pipelineVersion: 'test',
  });
}

async function addImport(
  imports: InMemoryUserImportRepository,
  params: { userId: string; contentSourceId: string; url: string },
) {
  await imports.insert({
    userId: params.userId,
    rawInput: params.url,
    sourceUrl: params.url,
    normalizedUrl: params.url,
    dedupeKey: `${params.userId}:${params.url}`,
    platform: 'youtube',
    contentSourceId: params.contentSourceId,
    status: 'RECEIVED',
  });
}

function createHarness(
  options: {
    video?: VideoFn;
    web?: WebFn;
    resolution?: ContentSourceResolutionPort;
  } = {},
) {
  const sources = new InMemoryContentSourceRepository();
  const imports = new InMemoryUserImportRepository();
  const videoCalls: ContentSourceRecord[] = [];
  const webCalls: ContentSourceRecord[] = [];
  const catalogWrites: string[] = [];
  const bagWrites: string[] = [];
  const resolverCalls: string[] = [];

  const video: VideoExtractionPort = {
    extract: async (params) => {
      videoCalls.push(params.contentSource);
      assert.equal(params.traceId.includes(USER_A), false);
      if (options.video) return options.video(params);
      return videoResult({ products: [], empty: true });
    },
  };
  const web: WebEnrichmentPort = {
    enrich: async (params) => {
      webCalls.push(params.contentSource);
      if (options.web) return options.web(params);
      return { candidate: null, empty: true } satisfies WebEnrichmentPortResult;
    },
  };
  const userImports: UserImportLookupPort = {
    listByContentSourceId: async (id) =>
      (await imports.listByContentSourceId(id)).map((row) => ({ id: row.id, userId: row.userId })),
  };

  const processor = new ContentSourceProcessor({
    sources,
    userImports,
    video,
    web,
    processorVersion: 'test-processor',
    resolution: options.resolution ?? null,
  });

  return {
    sources,
    imports,
    videoCalls,
    webCalls,
    catalogWrites,
    bagWrites,
    resolverCalls,
    processor,
    assertNoProductWrites() {
      assert.equal(catalogWrites.length, 0);
      assert.equal(bagWrites.length, 0);
      assert.equal(resolverCalls.length, 0);
    },
  };
}

const TWO_PRODUCTS: VideoExtractionPortResult['products'] = [
  {
    name: 'Sony WH-1000XM5',
    brand: 'Sony',
    model: 'WH-1000XM5',
    category: 'headphones',
    confidence: 0.9,
    sources: ['METADATA'],
    sortOrder: 1,
  },
  {
    name: 'Bose QuietComfort',
    brand: 'Bose',
    category: 'headphones',
    confidence: 0.8,
    sources: ['TRANSCRIPT'],
    sortOrder: 2,
  },
];

describe('ContentSourceProcessor video', () => {
  it('reuses a cached extraction result', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS, cacheHit: true, finalStage: 'cache' }),
    });
    const source = await insertQueued(harness.sources, 'VIDEO');

    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });

    const stored = await harness.sources.findById(source.id);
    const products = await harness.sources.listProducts(source.id);
    assert.equal(stored?.processingStatus, 'READY');
    assert.equal(stored?.candidateCount, 2);
    assert.equal(products.length, 2);
    assert.equal(products[0]?.extractionMethod, 'cache');
    assert.equal(products[0]?.name, 'Sony WH-1000XM5');
    assert.equal(products[1]?.name, 'Bose QuietComfort');
    assert.equal(harness.videoCalls.length, 1);
    harness.assertNoProductWrites();
  });

  it('runs uncached extraction once for a source', async () => {
    let runs = 0;
    const harness = createHarness({
      video: async () => {
        runs += 1;
        return videoResult({ products: TWO_PRODUCTS, cacheHit: false, finalStage: 'stage1' });
      },
    });
    const source = await insertQueued(harness.sources, 'VIDEO');

    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_B,
      traceId: TRACE,
    });

    assert.equal(runs, 1);
    assert.equal((await harness.sources.listProducts(source.id)).length, 2);
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'READY');
  });

  it('maps source identity onto the video extraction port, not a user import', async () => {
    const harness = createHarness({
      video: async ({ contentSource, traceId }) => {
        assert.equal(contentSource.platform, 'youtube');
        assert.equal(contentSource.externalId, 'dQw4w9WgXcQ');
        assert.equal(contentSource.mediaKind, 'VIDEO');
        assert.equal(traceId, TRACE);
        return videoResult({ products: [TWO_PRODUCTS[0]!] });
      },
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    assert.equal(harness.videoCalls[0]?.id, source.id);
  });

  it('persists multiple products for one source', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS }),
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    const products = await harness.sources.listProducts(source.id);
    assert.equal(products.map((p) => p.position).join(','), '1,2');
    assert.equal(products[0]?.brand, 'Sony');
    assert.equal(products[0]?.model, 'WH-1000XM5');
  });

  it('marks extraction failure as terminal FAILED', async () => {
    const harness = createHarness({
      video: async () => {
        throw new ContentSourceTerminalError('This video could not be loaded', 'SOURCE_UNAVAILABLE');
      },
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    const stored = await harness.sources.findById(source.id);
    assert.equal(stored?.processingStatus, 'FAILED');
    assert.match(stored?.failureReason ?? '', /could not be loaded/);
    assert.equal((await harness.sources.listProducts(source.id)).length, 0);
  });

  it('treats a successful no-product extract as READY, not FAILED', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: [], empty: true, finalStage: 'stage1' }),
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    const stored = await harness.sources.findById(source.id);
    assert.equal(stored?.processingStatus, 'READY');
    assert.equal(stored?.candidateCount, 0);
    assert.equal(stored?.failureReason, null);
    assert.equal((await harness.sources.listProducts(source.id)).length, 0);
  });
});

describe('ContentSourceProcessor web', () => {
  it('calls the existing enrichment path and persists one candidate', async () => {
    const harness = createHarness({
      web: async ({ contentSource }) => {
        assert.equal(contentSource.canonicalUrl, 'https://shop.example.com/p/mug');
        return {
          empty: false,
          candidate: {
            name: 'Stoneware Mug',
            brand: 'Example',
            category: null,
            price: '$24',
            currency: 'USD',
            image: 'https://cdn.example.com/mug.jpg',
            merchantUrl: 'https://shop.example.com/p/mug',
            evidence: { provider: 'tavily' },
          },
        };
      },
    });
    const source = await insertQueued(harness.sources, 'WEB_PAGE');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    const products = await harness.sources.listProducts(source.id);
    assert.equal(harness.webCalls.length, 1);
    assert.equal(harness.videoCalls.length, 0);
    assert.equal(products.length, 1);
    assert.equal(products[0]?.name, 'Stoneware Mug');
    assert.equal(products[0]?.extractionMethod, 'merchant_enrichment');
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'READY');
  });

  it('treats enrichment-without-product as READY with zero candidates', async () => {
    const harness = createHarness({
      web: async () => ({ candidate: null, empty: true }),
    });
    const source = await insertQueued(harness.sources, 'WEB_PAGE');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'READY');
    assert.equal((await harness.sources.findById(source.id))?.candidateCount, 0);
  });

  it('retries thrown enrichment failures without marking FAILED', async () => {
    const harness = createHarness({
      web: async () => {
        throw new Error('tavily timeout');
      },
    });
    const source = await insertQueued(harness.sources, 'WEB_PAGE');
    await assert.rejects(
      () =>
        harness.processor.process(
          { contentSourceId: source.id, userImportId: IMPORT_A, traceId: TRACE },
          { attemptsMade: 0, maxAttempts: 3 },
        ),
      /tavily timeout/,
    );
    const stored = await harness.sources.findById(source.id);
    assert.equal(stored?.processingStatus, 'PROCESSING');
    assert.equal(stored?.failureReason, null);
  });
});

describe('ContentSourceProcessor global reuse', () => {
  it('stores one shared result for two user imports of the same source', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS }),
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    await addImport(harness.imports, {
      userId: USER_A,
      contentSourceId: source.id,
      url: source.canonicalUrl,
    });
    await addImport(harness.imports, {
      userId: USER_B,
      contentSourceId: source.id,
      url: source.canonicalUrl,
    });

    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_B,
      traceId: TRACE,
    });

    const listed = await harness.imports.listByContentSourceId(source.id);
    assert.equal(listed.length, 2);
    assert.equal(harness.videoCalls.length, 1);
    assert.equal((await harness.sources.listProducts(source.id)).length, 2);
    assert.equal(harness.sources.products.size, 2);
    harness.assertNoProductWrites();
  });
});

describe('ContentSourceProcessor idempotency and state', () => {
  it('does not duplicate candidates when the worker runs twice', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS }),
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    const job = { contentSourceId: source.id, userImportId: IMPORT_A, traceId: TRACE };
    await harness.processor.process(job);
    const afterFirst = await harness.sources.findById(source.id);
    assert.equal(afterFirst?.processingStatus, 'READY');

    // Simulate a redelivered job after a crash that left PROCESSING claimable.
    const current = harness.sources.sources.get(source.id);
    assert.ok(current);
    current.processingStatus = 'QUEUED';
    await harness.processor.process(job);

    const products = await harness.sources.listProducts(source.id);
    assert.equal(products.length, 2);
    assert.equal(harness.sources.products.size, 2);
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'READY');
  });

  it('moves QUEUED → PROCESSING → READY', async () => {
    let seenStatus: string | null = null;
    const harness = createHarness({
      video: async ({ contentSource }) => {
        seenStatus = contentSource.processingStatus;
        return videoResult({ products: [TWO_PRODUCTS[0]!] });
      },
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    assert.equal(source.processingStatus, 'QUEUED');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    assert.equal(seenStatus, 'PROCESSING');
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'READY');
  });

  it('leaves PROCESSING on a retryable failure and FAILED on the last attempt', async () => {
    const harness = createHarness({
      video: async () => {
        throw new Error('openai 429');
      },
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    const job = { contentSourceId: source.id, userImportId: IMPORT_A, traceId: TRACE };

    await assert.rejects(
      () => harness.processor.process(job, { attemptsMade: 0, maxAttempts: 3 }),
      /openai 429/,
    );
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'PROCESSING');

    await assert.rejects(
      () => harness.processor.process(job, { attemptsMade: 2, maxAttempts: 3 }),
      /openai 429/,
    );
    const stored = await harness.sources.findById(source.id);
    assert.equal(stored?.processingStatus, 'FAILED');
    assert.match(stored?.failureReason ?? '', /openai 429/);
  });

  it('skips a missing source without throwing', async () => {
    const harness = createHarness();
    await harness.processor.process({
      contentSourceId: '00000000-0000-4000-8000-000000000000',
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    assert.equal(harness.videoCalls.length, 0);
  });

  it('does not reprocess a READY source', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS }),
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    const job = { contentSourceId: source.id, userImportId: IMPORT_A, traceId: TRACE };
    await harness.processor.process(job);
    await harness.processor.process(job);
    assert.equal(harness.videoCalls.length, 1);
  });

  it('runs resolution after candidates persist', async () => {
    const resolved: string[] = [];
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS }),
      resolution: {
        resolveAndFanOut: async (id) => {
          resolved.push(id);
        },
      },
    });
    const source = await insertQueued(harness.sources, 'VIDEO');
    await harness.processor.process({
      contentSourceId: source.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    assert.deepEqual(resolved, [source.id]);
    assert.equal((await harness.sources.findById(source.id))?.processingStatus, 'READY');
    assert.equal((await harness.sources.listProducts(source.id)).length, 2);
  });
});

describe('ContentSourceProcessor negative scope', () => {
  it('does not write catalog, discovered products, Bag, or invoke ShoppingResolver', async () => {
    const harness = createHarness({
      video: async () => videoResult({ products: TWO_PRODUCTS }),
      web: async () => ({ candidate: null, empty: true }),
    });
    const video = await insertQueued(harness.sources, 'VIDEO');
    await harness.processor.process({
      contentSourceId: video.id,
      userImportId: IMPORT_A,
      traceId: TRACE,
    });
    harness.assertNoProductWrites();

    const files = [
      'ContentSourceProcessor.ts',
      'mapCandidates.ts',
      'errors.ts',
      'createProcessor.ts',
    ].map((file) => readFileSync(join(__dirname, file), 'utf8'));
    for (const src of files) {
      assert.doesNotMatch(src, /catalog_products|discovered_products|cart_items/);
      assert.doesNotMatch(src, /ShoppingResolver|resolveIngestDrafts|ProductResolver/);
      assert.doesNotMatch(src, /from ['"].*CartService['"]/);
    }

    const videoAdapter = readFileSync(join(__dirname, 'videoAdapter.ts'), 'utf8');
    assert.match(videoAdapter, /runProgressiveExtract/);
    assert.doesNotMatch(videoAdapter, /class .*Reasoner|new OpenAi/);

    const webAdapter = readFileSync(join(__dirname, 'webAdapter.ts'), 'utf8');
    assert.match(webAdapter, /MerchantEnrichmentService/);
    assert.match(webAdapter, /canonicalizeProductUrl/);
    assert.match(webAdapter, /from ['"].*urlCanonicalization['"]/);
    assert.doesNotMatch(webAdapter, /class .*Canonicaliz|function canonicalizeProductUrl/);

    const extract = readFileSync(join(__dirname, '../../stages/progressiveExtract.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');
    assert.match(extract, /OpenAiReasonerProvider/);
    assert.match(extract, /getVideoExtractionCache/);
    assert.match(extract, /setVideoExtractionCache/);
    assert.match(extract, /needsStage2Enrichment/);
    assert.doesNotMatch(extract, /catalog_products|cart_items|discovered_products/);
    assert.doesNotMatch(extract, /resolveIngestDrafts|ShoppingResolver/);
  });
});
