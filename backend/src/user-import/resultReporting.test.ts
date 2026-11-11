import { testSnapshots } from './find/testSnapshot';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { ContentSourceService } from '../content-source/ContentSourceService';
import { ContentSourceProcessor } from '../content-source/processing/ContentSourceProcessor';
import { InMemoryPlaceRepository } from '../place/InMemoryPlaceRepository';
import { PlaceResolver } from '../place/PlaceResolver';
import { syncImportPlaces } from '../place/syncImportPlaces';
import { InMemoryUserImportRepository } from './InMemoryUserImportRepository';
import { InMemoryImportProgressRepository } from './ImportProgressRepository';
import { UserImportService } from './UserImportService';
import { USER_IMPORT_TIMEOUT_MS } from './domain/shareProgress';
import type { ExtractedPlaceMention } from '../place/parseReasonerPayload';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';
const URL = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
const mention: ExtractedPlaceMention = {
  name: 'Potato Head', locality: 'Seminyak', city: null, country: null, region: null,
  mentionedAddress: null, category: null, confidence: 0.9, evidence: {}, sources: ['METADATA'],
};

function harness(options: { persistedCheck?:()=>Promise<boolean>; productName?:string; products?: boolean; places?: boolean; productGate?: () => Promise<void>; placeGate?: () => Promise<void> } = {}) {
  const sources = new InMemoryContentSourceRepository();
  const imports = new InMemoryUserImportRepository();
  const places = new InMemoryPlaceRepository();
  const progress = new InMemoryImportProgressRepository();
  const sourceService = new ContentSourceService(sources, { enqueue: async () => 'fixture-job' });
  let clock = Date.now();
  let extractionCalls = 0;
  let productCalls = 0;
  let searchCalls = 0;
  let providerFails = false;
  const service = new UserImportService(imports, {
    getOrCreate: (url) => sourceService.getOrCreate(url), getById: (id) => sources.findById(id),
    listProducts: (id) => sources.listProducts(id),
    requestProcessing: (params) => sourceService.requestProcessing(params),
    requestReprocessing: (params) => sourceService.requestReprocessing(params),
  }, null, {
    memberships: testSnapshots(imports, { getById: id => sources.findById(id), listProducts: id => sources.listProducts(id) },
      { progress, places: id => places.countByUserImport(id), now: () => clock }), syncPlaces: (row) => syncImportPlaces(places, row),
  }, () => clock);
  const processor = new ContentSourceProcessor({
    sources, userImports: imports, places, progress, hasPersistedResults:options.persistedCheck,
    video: { extract: async () => {
      extractionCalls++;
      return { products: options.products ? [{ name: options.productName ?? 'Fixture camera' }] : [], places: options.places ? [mention] : [],
        extractionMethod: 'cache', cacheHit: true, empty: !options.products, finalStage: 'cache' };
    } },
    web: { enrich: async () => { throw new Error('No web calls allowed'); } },
    resolution: { resolveAndFanOut: async (id) => {
      productCalls++;
      await options.productGate?.();
      for (const product of await sources.listProducts(id)) {
        await sources.bindProductResolution(product.id, { catalogProductId: PRODUCT, discoveredProductId: null });
      }
      return (await sources.listProducts(id)).length;
    } },
    placeResolver: new PlaceResolver(places, { name: 'fixture', search: async () => {
      searchCalls++;
      await options.placeGate?.();
      return providerFails ? { ok: false, reason: 'provider_failed' }
        : { ok: true, candidates: [{ providerPlaceId: 'known-place', name: 'Potato Head', locality: 'Seminyak' }] };
    } }),
  });
  return { sources, imports, places, progress, service,
    setClock: (value: number) => { clock = value; }, failProvider: (value: boolean) => { providerFails = value; },
    calls: () => ({ extractionCalls, productCalls, searchCalls }),
    process: (row: { id: string; contentSourceId: string | null }, attemptsMade = 2) => processor.process({
      contentSourceId: row.contentSourceId!, userImportId: row.id,
    }, { attemptsMade, maxAttempts: 3 }),
  };
}

for (const [products, places] of [[false, false], [true, false], [false, true], [true, true]]) {
  it(`reports persisted results and legacy fields: products=${products}, places=${places}`, async () => {
    const h = harness({ products, places });
    const { record } = await h.service.submit(USER, { rawInput: URL });
    await h.process(record);
    const [result] = await h.service.listRecent(USER);
    assert.equal(result.productCount, products ? 1 : 0);
    assert.equal(result.placeCount, places ? 1 : 0);
    assert.equal(result.productStatus, 'complete');
    assert.equal(result.placeStatus, 'complete');
    assert.equal(result.state, products || places ? 'ready' : 'nothing_yet');
    assert.equal(result.hasInFlight, false);
    assert.equal(result.canRetry, false);
  });
}

it('reports place completion while products run, then preserves places on product failure and retries only products', async () => {
  let reject!: (err: Error) => void;
  let release!: () => void;
  let failed = false;
  const gate = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const h = harness({ products: true, places: true, productGate: () => failed ? Promise.resolve() : gate });
  const { record } = await h.service.submit(USER, { rawInput: URL });
  const processing = h.process(record);
  // Wait for persisted branch completion, not a wall-clock assumption.
  for (let i = 0; i < 100 && (await h.progress.get(record.contentSourceId!))?.places !== 'complete'; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const [partial] = await h.service.listRecent(USER);
  assert.equal(partial.placeStatus, 'complete');
  assert.equal(partial.productStatus, 'running');
  assert.equal(partial.placeCount, 1);
  assert.equal(partial.state, 'ready');
  assert.equal(partial.hasInFlight, true);
  reject(new Error('fixture product failure'));
  await processing;
  failed = true;
  release();
  const [failure] = await h.service.listRecent(USER);
  assert.equal(failure.placeCount, 1);
  assert.equal(failure.productStatus, 'failed');
  assert.equal(failure.placeStatus, 'complete');
  assert.equal(failure.canRetry, true);
  await h.service.retry(USER, record.id);
  await h.process(record);
  assert.deepEqual(h.calls(), { extractionCalls: 1, productCalls: 2, searchCalls: 1 });
  assert.equal((await h.service.listRecent(USER))[0].resultProductCount, 1);
});

it('keeps products and unverified leads on provider failure; retry does not re-extract or resolve products', async () => {
  const h = harness({ products: true, places: true });
  h.failProvider(true);
  const { record } = await h.service.submit(USER, { rawInput: URL });
  await h.process(record);
  const [partial] = await h.service.listRecent(USER);
  assert.equal(partial.productCount, 1);
  assert.equal(partial.placeCount, 1);
  assert.equal(partial.findOutcome.foundPlaces, 1);
  assert.equal(partial.placeStatus, 'failed');
  h.failProvider(false);
  await h.service.retry(USER, record.id);
  await h.process(record);
  assert.deepEqual(h.calls(), { extractionCalls: 1, productCalls: 1, searchCalls: 2 });
  assert.equal((await h.service.listRecent(USER))[0].findOutcome.places, 'complete');
});

it('late users receive existing places, and repeated imports do not stack cards or provider calls', async () => {
  const h = harness({ places: true });
  const { record } = await h.service.submit(USER, { rawInput: URL });
  await h.process(record);
  await h.service.submit(OTHER, { rawInput: URL });
  await h.service.submit(OTHER, { rawInput: URL });
  assert.equal((await h.places.listSavesByUser(OTHER)).length, 1);
  assert.equal((await h.service.listRecent(OTHER))[0].placeCount, 1);
  assert.equal(h.calls().searchCalls, 1);
});

it('history removal preserves saves/source and deliberate re-share restores the same import', async () => {
  const h = harness({ places: true });
  const { record } = await h.service.submit(USER, { rawInput: URL });
  await h.process(record);
  await h.service.delete(USER, record.id);
  assert.deepEqual(await h.service.listRecent(USER), []);
  assert.equal((await h.places.listSavesByUser(USER)).length, 1);
  assert.ok(await h.sources.findById(record.contentSourceId!));
  await assert.rejects(h.service.retry(OTHER, record.id), /Import not found/);
  const restored = await h.service.submit(USER, { rawInput: URL });
  assert.equal(restored.record.id, record.id);
  assert.equal((await h.service.listRecent(USER)).length, 1);
});

it('delayed work stays active and cannot be retried prematurely', async () => {
  const h = harness();
  const { record } = await h.service.submit(USER, { rawInput: URL });
  h.setClock(Date.parse(record.createdAt) + USER_IMPORT_TIMEOUT_MS + 1000);
  const result = (await h.service.listRecent(USER))[0];
  assert.equal(result.findOutcome.delayed, true);
  await assert.rejects(h.service.retry(USER, record.id), /cannot be retried/);
  assert.equal((await h.imports.findById(record.id))?.timedOutAt, null);
});

it('late reporting from a previous attempt cannot overwrite the current attempt', async () => {
  const progress = new InMemoryImportProgressRepository();
  const first = await progress.begin('source');
  const second = await progress.begin('source');
  await progress.finish('source', first.attemptId, 'products', 'complete');
  assert.equal((await progress.get('source'))?.products, 'running');
  await progress.finish('source', second.attemptId, 'products', 'complete');
  assert.equal((await progress.get('source'))?.products, 'complete');
});

it('products are visible while Places is still running; a mid-flight importer receives the final place', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ products: true, places: true, placeGate: () => gate });
  const { record } = await h.service.submit(USER, { rawInput: URL });
  const processing = h.process(record);
  for (let i = 0; i < 100 && (await h.progress.get(record.contentSourceId!))?.products !== 'complete'; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const [partial] = await h.service.listRecent(USER);
  assert.equal(partial.productCount, 1);
  assert.equal(partial.resultProductCount, 1);
  assert.equal(partial.resultProducts?.[0].productId, PRODUCT);
  assert.equal(partial.placeStatus, 'running');
  await h.service.submit(OTHER, { rawInput: URL });
  release();
  await processing;
  assert.equal((await h.places.listSavesByUser(OTHER)).length, 1);
});

it('reporting never writes a historical timeout marker', async () => {
  const h = harness();
  const { record } = await h.service.submit(USER, { rawInput: URL });
  h.setClock(Date.parse(record.createdAt) + USER_IMPORT_TIMEOUT_MS + 1000);
  h.imports.markTimedOut = async () => { throw new Error('Unexpected reporting write'); };
  assert.equal((await h.service.listRecent(USER))[0].findOutcome.delayed, true);
});

it('reports a place found on another source even when the canonical card was already saved', async () => {
  const h = harness({ places: true });
  const first = await h.service.submit(USER, { rawInput: URL });
  await h.process(first.record);
  const second = await h.service.submit(USER, { rawInput: 'https://www.youtube.com/shorts/abcdefghijk' });
  await h.process(second.record);
  assert.equal((await h.places.listSavesByUser(USER)).length, 1);
  const result = (await h.service.listRecent(USER)).find((row) => row.importId === second.record.id)!;
  assert.equal(result.placeCount, 1);
});

it('completion racing the progress request cannot return COMPLETE with a stale zero count', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ products: true, productGate: () => gate });
  const { record } = await h.service.submit(USER, { rawInput: URL });
  const processing = h.process(record);
  const original = h.progress.get.bind(h.progress);
  for (let i = 0; i < 100 && (await original(record.contentSourceId!))?.places !== 'complete'; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  h.progress.get = async (id) => {
    release();
    await processing;
    return original(id);
  };
  const [result] = await h.service.listRecent(USER);
  assert.equal(result.productStatus, 'complete');
  assert.equal(result.resultProductCount, 1);
  assert.equal(result.hasInFlight, false);
});

it('completes useful place results after the first optional product failure; manual retry reuses Places', async () => {
  let fails = true;
  const h = harness({ products: true, places: true, productGate: async () => {
    if (fails) throw new Error('retryable fixture');
  } });
  const { record } = await h.service.submit(USER, { rawInput: URL });
  await h.process(record, 0);
  const [done] = await h.service.listRecent(USER);
  assert.equal(done.productStatus, 'failed');
  assert.equal(done.placeStatus, 'complete');
  assert.equal(done.hasInFlight, false);
  assert.equal(done.findOutcome.category, 'completed');
  assert.equal(done.canRetry, true);
  assert.deepEqual(h.calls(),{extractionCalls:1,productCalls:1,searchCalls:1});
  fails = false;
  await h.service.retry(USER, record.id);
  await h.process(record, 0);
  assert.equal((await h.service.listRecent(USER))[0].resultProductCount, 1);
  assert.deepEqual(h.calls(), { extractionCalls: 1, productCalls: 2, searchCalls: 1 });
});
it('a processing failure without useful results preserves automatic retries',async()=>{
 const h=harness({products:true,productName:'Unknown',places:false,productGate:async()=>{throw new Error('transient');}});
 const {record}=await h.service.submit(USER,{rawInput:URL});
 await assert.rejects(h.process(record,0),/transient/);
 assert.equal((await h.service.listRecent(USER))[0].hasInFlight,true);
});
it('successful empty analysis is terminal and duplicate delivery makes no provider calls',async()=>{
 const h=harness();const {record}=await h.service.submit(USER,{rawInput:URL});
 await h.process(record,0);await h.process(record,1);
 const [done]=await h.service.listRecent(USER);assert.equal(done.findOutcome.category,'completed');assert.equal(done.findOutcome.result,'empty');assert.equal(done.canRetry,false);
 assert.deepEqual(h.calls(),{extractionCalls:1,productCalls:1,searchCalls:0});
});

it('early branch completion cannot stop polling before shared evidence is final', async () => {
  const h = harness();
  const { record } = await h.service.submit(USER, { rawInput: URL });
  await h.sources.markProcessing(record.contentSourceId!);
  const early = await h.progress.begin(record.contentSourceId!);
  await h.progress.finish(record.contentSourceId!, early.attemptId, 'products', 'complete');
  await h.progress.finish(record.contentSourceId!, early.attemptId, 'places', 'complete');
  assert.equal((await h.service.listRecent(USER))[0].hasInFlight, true);
  await h.progress.completeEvidence(record.contentSourceId!, early.attemptId);
  assert.equal((await h.service.listRecent(USER))[0].hasInFlight, true); // Source owner has not finished yet.
});

it('a useful persisted description completes with a search suggestion, without inventing a confirmed product',async()=>{
 const h=harness({products:true,productName:'Black mini dress',productGate:async()=>{throw new Error('Exact identity unavailable');}});
 const {record}=await h.service.submit(USER,{rawInput:URL});await h.process(record,0);await h.process(record,1);
 const [done]=await h.service.listRecent(USER);
 assert.equal(done.findOutcome.category,'completed');assert.equal(done.findOutcome.result,'partial');
 assert.equal(done.findOutcome.discoveryProducts,1);assert.equal(done.findOutcome.foundProducts,0);assert.equal(done.findOutcome.savedProducts,0);
 assert.equal((await h.sources.findById(record.contentSourceId!))?.processingStatus,'READY');
 assert.deepEqual(h.calls(),{extractionCalls:1,productCalls:1,searchCalls:0});
});

it('persistence uncertainty never suppresses recovery despite a saved-looking place',async()=>{
 const h=harness({products:false,places:true,persistedCheck:async()=>{throw new Error('Storage unavailable');},productGate:async()=>{throw new Error('branch unavailable');}});
 const {record}=await h.service.submit(USER,{rawInput:URL});
 await assert.rejects(h.process(record,0),/branch unavailable/);
 assert.equal((await h.sources.findById(record.contentSourceId!))?.processingStatus,'PROCESSING');
 assert.equal((await h.service.listRecent(USER))[0].hasInFlight,true);
});
