import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { PlaceResolver } from './PlaceResolver';
import { PlaceService } from './PlaceService';
import { syncImportPlaces } from './syncImportPlaces';
import { discoveryStageDecision } from '../stages/gate';
import { InMemoryImportProgressRepository, runImportWork } from '../user-import/ImportProgressRepository';
import { ContentSourceProcessor } from '../content-source/processing/ContentSourceProcessor';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { InMemoryUserImportRepository } from '../user-import/InMemoryUserImportRepository';
import type { ExtractedPlaceMention } from './parseReasonerPayload';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProgressiveExtract, type ProgressiveEvidence, type ProgressiveExtractRuntime } from '../stages/progressiveExtract';

const mention: ExtractedPlaceMention = { name: 'Potato Head', locality: 'Seminyak', city: null, region: null, country: null,
  category: null, mentionedAddress: null, confidence: 0.9, evidence: {}, sources: ['METADATA'] };

it('place gates publish grounded specifics, preserve hidden-product enrichment, and reject unsupported/generic names', () => {
  const ready = discoveryStageDecision([], [mention], 'Potato Head in Seminyak');
  assert.equal(ready.placesSettled, true);
  assert.equal(ready.productsSettled, false);
  assert.equal(ready.needsSharedEnrichment, true, 'a place is not proof of no merchandise');
  assert.deepEqual(discoveryStageDecision([], [mention], 'A generic visit').earlyPlaces, []);
  assert.deepEqual(discoveryStageDecision([], [{ ...mention, name: 'Cafe' }], 'Cafe in Seminyak').earlyPlaces, []);
  assert.deepEqual(discoveryStageDecision([], [{ ...mention, confidence: 0.1 }], 'Potato Head in Seminyak').earlyPlaces, []);
});

it('ambiguous provisional matches are searched once per attempt and only become saved leads at final evidence', async () => {
  const places = new InMemoryPlaceRepository();
  let calls = 0;
  const resolver = new PlaceResolver(places, { name: 'fixture', search: async () => {
    calls++;
    return { ok: true, candidates: [{ providerPlaceId: 'a', name: mention.name, locality: 'Seminyak' },
      { providerPlaceId: 'b', name: mention.name, locality: 'Seminyak' }] };
  } });
  await runImportWork(new InMemoryImportProgressRepository(), 'source', async () => {
    const input = { contentSourceId: 'source', imports: [{ id: 'import', userId: 'user' }], mentions: [mention] };
    await resolver.resolveMentions({ ...input, provisional: true });
    assert.equal((await places.listSavesByUser('user')).length, 0);
    await resolver.resolveMentions(input);
    assert.equal((await places.listSavesByUser('user')).length, 1);
  });
  assert.equal(calls, 1);
});

it('canonical cards expose all source attributions and preserve legacy source/id fields', async () => {
  const places = new InMemoryPlaceRepository();
  const resolver = new PlaceResolver(places, { name: 'fixture', search: async () => ({ ok: true,
    candidates: [{ providerPlaceId: 'same-place', name: mention.name, locality: 'Seminyak' }] }) });
  await resolver.resolveMentions({ contentSourceId: 'source1', imports: [{ id: 'import1', userId: 'user' }], mentions: [mention] });
  await resolver.resolveMentions({ contentSourceId: 'source2', imports: [{ id: 'import2', userId: 'user' }], mentions: [mention] });
  const page = await new PlaceService(places).listForUser('user');
  assert.equal(page.itemCount, 1);
  assert.equal(page.items[0].resolutionStatus, 'resolved');
  assert.deepEqual(page.items[0].source, { contentSourceId: 'source1', userImportId: 'import1' });
  assert.deepEqual(page.items[0].sources.map((s) => s.contentSourceId), ['source1', 'source2']);
  assert.deepEqual((await new PlaceService(places).listForUser('other')).items, []);
});

it('repeated-source URLs and late imports retain their own edges without duplicate cards or searches', async () => {
  const places = new InMemoryPlaceRepository();
  let calls = 0;
  const resolver = new PlaceResolver(places, { name: 'fixture', search: async () => {
    calls++;
    return { ok: true, candidates: [{ providerPlaceId: 'same', name: mention.name, locality: 'Seminyak' }] };
  } });
  const input = { contentSourceId: 'source', imports: [{ id: 'import1', userId: 'user' }], mentions: [mention] };
  await resolver.resolveMentions(input);
  await resolver.resolveMentions({ ...input, imports: [{ id: 'import2', userId: 'user' }] });
  await syncImportPlaces(places, { contentSourceId: 'source', id: 'import3', userId: 'user' });
  assert.equal((await places.listSavesByUser('user')).length, 1);
  assert.deepEqual((await places.listSourcesByUser('user')).map((s) => s.userImportId), ['import1', 'import2', 'import3']);
  for (const id of ['import1', 'import2', 'import3']) assert.equal(await places.countByUserImport(id), 1);
  assert.equal(calls, 1);
});

it('media failure does not become a successful empty product result; Places survive and retry needs fresh evidence', async () => {
  const sources = new InMemoryContentSourceRepository(), imports = new InMemoryUserImportRepository();
  const places = new InMemoryPlaceRepository(), progress = new InMemoryImportProgressRepository();
  const source = await sources.insert({ platform: 'youtube', externalId: 'fixture', canonicalUrl: 'https://example.invalid',
    mediaKind: 'VIDEO', processingStatus: 'QUEUED', pipelineVersion: 'fixture' });
  let extractionCalls = 0;
  const processor = new ContentSourceProcessor({ sources, userImports: imports, places, progress,
    video: { extract: async () => { extractionCalls++; return { products: [], places: [mention], productsIncomplete: true,
      cacheHit: false, empty: true, finalStage: 'stage1', extractionMethod: 'ai_extract' }; } },
    web: { enrich: async () => { throw new Error('No calls'); } },
    placeResolver: new PlaceResolver(places, { name: 'fixture', search: async () => ({ ok: false, reason: 'provider_failed' }) }),
    resolution: { resolveAndFanOut: async () => 0 },
  });
  await assert.rejects(processor.process({ contentSourceId: source.id, userImportId: 'import' }, { attemptsMade: 0, maxAttempts: 3 }), /evidence enrichment/);
  assert.equal((await progress.get(source.id))?.evidenceComplete, false);
  assert.equal((await places.listHypotheses(source.id)).length, 1);
  await assert.rejects(processor.process({ contentSourceId: source.id, userImportId: 'import' }, { attemptsMade: 1, maxAttempts: 3 }), /evidence enrichment/);
  assert.equal(extractionCalls, 2, 'incomplete evidence cannot use the downstream-only retry shortcut');
});

function failedMediaRuntime(onCleanup: () => void, onCache: () => void): ProgressiveExtractRuntime {
  return { context: async () => ({ title: 'Potato Head in Seminyak', description: '', descriptionSource: 'fixture',
    creator: '', thumbnailUrl: null, transcript: '' }),
  reasoner: { name: 'fixture', reason: async () => ({ products: [], places: [mention], meta: { provider: 'fixture', durationMs: 0 } }) },
  readCache: async () => null, writeCache: async () => { onCache(); return 'fixture'; },
  workDir: async () => '/fixture/no-files',
  media: { name: 'fixture', analyze: async () => { throw new Error('Unexpected media call'); } },
  video: { name: 'fixture', download: async () => { throw new Error('fixture download failed'); }, cleanup: async () => onCleanup() } };
}

it('actual progressive extraction retains Places on media failure without caching an empty success', async () => {
  let cleanups = 0, caches = 0;
  const snapshots: ProgressiveEvidence[] = [];
  const result = await runProgressiveExtract({ admin: {} as SupabaseClient, sourceUrl: 'https://example.invalid/video',
    platform: 'youtube', externalVideoId: 'fixture', correlationId: 'fixture', traceId: 'fixture', cacheScope: 'user-import',
    onEvidence: (snapshot) => snapshots.push(snapshot) }, failedMediaRuntime(() => cleanups++, () => caches++));
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.productsIncomplete, true);
  assert.deepEqual(result.places, [mention]);
  assert.equal(snapshots.at(-1)?.productsSettled, false);
  assert.equal(snapshots.at(-1)?.finalEvidence, true);
  assert.equal(caches, 0);
  assert.equal(cleanups, 1);
});

it('unexpected evidence callback failure still cleans the extraction work directory', async () => {
  let cleanups = 0;
  await assert.rejects(runProgressiveExtract({ admin: {} as SupabaseClient, sourceUrl: 'https://example.invalid/video',
    platform: 'youtube', externalVideoId: 'fixture', correlationId: 'fixture', traceId: 'fixture', cacheScope: 'user-import',
    onEvidence: (snapshot) => { if (snapshot.finalEvidence) throw new Error('fixture publish failed'); } },
  failedMediaRuntime(() => cleanups++, () => {})), /fixture publish failed/);
  assert.equal(cleanups, 1);
});
