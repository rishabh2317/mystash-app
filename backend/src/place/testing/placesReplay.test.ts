import assert from 'node:assert/strict';
import { it, before, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { baselineExtract, BaselineProcessor, BaselinePlaceResolver } from './replayBaseline';
import { runProgressiveExtract, type ProgressiveExtractRuntime } from '../../stages/progressiveExtract';
import { InMemoryContentSourceRepository } from '../../content-source/InMemoryContentSourceRepository';
import { InMemoryUserImportRepository } from '../../user-import/InMemoryUserImportRepository';
import { InMemoryImportProgressRepository } from '../../user-import/ImportProgressRepository';
import { ContentSourceProcessor } from '../../content-source/processing/ContentSourceProcessor';
import { createVideoExtractionAdapter } from '../../content-source/processing/videoAdapter';
import { InMemoryPlaceRepository } from '../InMemoryPlaceRepository';
import { PlaceResolver } from '../PlaceResolver';
import { splitReasonerPayload } from '../parseReasonerPayload';
import type { CachedExtractionPayload } from '../../services/extractionCache';

type Fixture = { id: string; text: string; stages: unknown[]; provider?: string; expectedProducts: string[]; expectedPlaces: string[] };
const recording = JSON.parse(readFileSync(join(__dirname, 'fixtures/recorded-responses.json'), 'utf8')) as { provenance: string; fixtures: Fixture[] };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const summaries: unknown[] = [];
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Network is forbidden in recorded replay'); }; });

async function replay(fixture: Fixture, baseline: boolean) {
  const calls = { reasoning: 0, mediaAi: 0, visionFeatures: 0, placeSearch: 0 };
  let peak = 0, active = 0, firstPlaceMs: number | null = null, firstProductMs: number | null = null;
  let cached: CachedExtractionPayload | null = null;
  const started = performance.now();
  const sources = new InMemoryContentSourceRepository();
  const places = new InMemoryPlaceRepository();
  const imports = new InMemoryUserImportRepository();
  const source = await sources.insert({ platform: 'youtube', externalId: 'recorded-id', canonicalUrl: 'https://example.invalid/video',
    mediaKind: 'VIDEO', processingStatus: 'QUEUED', pipelineVersion: 'replay' });
  const userImport = await imports.insert({ userId: '11111111-1111-4111-8111-111111111111', rawInput: 'fixture', sourceUrl: source.canonicalUrl,
    normalizedUrl: source.canonicalUrl, dedupeKey: fixture.id, platform: 'youtube', contentSourceId: source.id, status: 'RECEIVED' });
  const attach = places.insertLead.bind(places);
  places.insertLead = async (row) => { const saved = await attach(row); firstPlaceMs ??= performance.now() - started; return saved; };
  const runtime: ProgressiveExtractRuntime = {
    context: async () => { await sleep(2); return { title: fixture.text, description: fixture.text, creator: '',
      descriptionSource: 'recorded', thumbnailUrl: null, transcript: fixture.text }; },
    reasoner: { name: 'recorded-combined-response', reason: async () => {
      const index = calls.reasoning++;
      await sleep(4);
      return { ...splitReasonerPayload(JSON.stringify(fixture.stages[Math.min(index, fixture.stages.length - 1)])),
        meta: { provider: 'recorded', durationMs: 4 } };
    } },
    readCache: async () => cached ? { cacheKey: 'recorded', payload: cached } : null,
    writeCache: async (_, value) => { cached = { ...value }; return 'recorded'; },
    workDir: async () => '/recorded/no-files',
    video: { name: 'recorded-video', download: async () => { await sleep(12); return { localPath: '/recorded/video', durationMs: 15000 }; }, cleanup: async () => {} },
    adaptiveFrames: async () => { await sleep(8); return { durationMs: 15000,
      frames: [3750, 7500, 11250].map((timestampMs, index) => ({ index, timestampMs, storagePath: 'recorded' })) }; },
    moreFrames: async ({ timestampsMs }) => { await sleep(8); return timestampsMs.map((timestampMs, index) => ({ index, timestampMs, storagePath: 'recorded' })); },
    upload: async (_, { frames }) => ({ frames, objectPaths: [], sha256s: [] }),
    media: { name: 'recorded-facts', analyze: async ({ frames }) => {
      calls.mediaAi += 2; calls.visionFeatures += frames.length * 2;
      await sleep(12);
      return { objects: [], logos: [], activities: [], ocr: [], frames, scene: { label: 'unknown', confidence: 0 }, providerMeta: {} };
    } },
  };
  const Resolver = baseline ? BaselinePlaceResolver : PlaceResolver;
  const resolver = new Resolver(places, { name: 'recorded-places', search: async (query) => {
    calls.placeSearch++; peak = Math.max(peak, ++active);
    try {
      await sleep(24);
      if (fixture.provider === 'failed') return { ok: false, reason: 'provider_failed' };
      const name = query.replace(/ Seminyak$/, '');
      return { ok: true, candidates: fixture.provider === 'ambiguous'
        ? [{ providerPlaceId: 'branch-a', name, city: 'Paris' }, { providerPlaceId: 'branch-b', name, city: 'London' }]
        : [{ providerPlaceId: name, name, locality: 'Seminyak' }] };
    } finally { active--; }
  } });
  const Processor = baseline ? BaselineProcessor : ContentSourceProcessor;
  const processor = new Processor({ sources, userImports: imports, places, placeResolver: resolver,
    progress: new InMemoryImportProgressRepository(),
    video: createVideoExtractionAdapter({} as SupabaseClient, (params) => (baseline ? baselineExtract : runProgressiveExtract)(params, runtime)),
    web: { enrich: async () => { throw new Error('Unexpected web extraction'); } },
    resolution: { resolveAndFanOut: async (id) => {
      await sleep(4);
      const rows = await sources.listProducts(id);
      for (const row of rows) { await sources.bindProductResolution(row.id, { catalogProductId: row.id, discoveredProductId: null }); firstProductMs ??= performance.now() - started; }
      return rows.length;
    } },
  });
  await processor.process({ contentSourceId: source.id, userImportId: userImport.id });
  const totalMs = performance.now() - started;
  const productNames = (await sources.listProducts(source.id)).filter((p) => p.catalogProductId).map((p) => p.name).sort();
  const saves = await places.listSavesByUser(userImport.userId);
  const placeNames = await Promise.all(saves.map(async (s) => s.placeId ? (await places.findPlaceById(s.placeId))!.name
    : (await places.findHypothesisById(s.contentSourcePlaceId))!.extractedName));
  const cold = { ...calls };
  await (baseline ? baselineExtract : runProgressiveExtract)({ admin: {} as SupabaseClient, platform: 'youtube', externalVideoId: 'recorded-id',
    sourceUrl: source.canonicalUrl, correlationId: source.id, traceId: 'replay', cacheScope: 'user-import' }, runtime);
  assert.deepEqual(calls, cold, 'warm extraction cache must make no AI/provider calls');
  return { productNames, placeNames: placeNames.sort(), calls: cold, peak, totalMs, firstPlaceMs, firstProductMs };
}

it('frozen milestone 1 sources match the pre-change SHA256 manifest', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, 'fixtures/milestone1-manifest.json'), 'utf8'));
  for (const name of ['gate', 'progressiveExtract', 'PlaceResolver', 'ContentSourceProcessor']) {
    const key = Object.keys(manifest).find((path) => path.endsWith(`/${name}.ts`))!;
    assert.equal(createHash('sha256').update(readFileSync(join(__dirname, 'fixtures', `${name}.ts.txt`))).digest('hex'), manifest[key]);
  }
});

for (const fixture of recording.fixtures) it(`recorded replay preserves quality/call budget: ${fixture.id}`, async () => {
  const samples = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const before = await replay(fixture, true);
    const after = await replay(fixture, false);
    assert.deepEqual(before.productNames, fixture.expectedProducts.slice().sort());
    assert.deepEqual(after.productNames, before.productNames);
    assert.deepEqual(before.placeNames, fixture.expectedPlaces.slice().sort());
    assert.deepEqual(after.placeNames, before.placeNames);
    assert.ok(after.calls.reasoning <= before.calls.reasoning);
    assert.ok(after.calls.mediaAi <= before.calls.mediaAi);
    assert.ok(after.calls.visionFeatures <= before.calls.visionFeatures);
    assert.ok(after.calls.placeSearch <= before.calls.placeSearch);
    assert.ok(after.peak <= 2);
    samples.push({ before, after });
  }
  summaries.push({ fixture: fixture.id, samples });
});

after(() => {
  globalThis.fetch = originalFetch;
  if (process.env.PLACES_REPLAY_REPORT) writeFileSync(process.env.PLACES_REPLAY_REPORT,
    JSON.stringify({ provenance: recording.provenance, timing: 'Actual local wall time with injected fixed-delay providers; not live-service latency',
      fixtureCount: recording.fixtures.length, repeats: 3, summaries }, null, 2) + '\n');
});
