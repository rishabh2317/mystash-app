import { projectFindOutcome } from './outcome';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserImportService } from '../UserImportService';
import { InMemoryUserImportRepository } from '../InMemoryUserImportRepository';
import { InMemoryImportProgressRepository } from '../ImportProgressRepository';
import { InMemoryContentSourceRepository } from '../../content-source/InMemoryContentSourceRepository';
import { ContentSourceService } from '../../content-source/ContentSourceService';
import { shareHistory } from '../share/history';
import type { SupabaseClient } from '@supabase/supabase-js';

test('recent/history share one mandatory outcome and ignore historical timeout markers', async () => {
  const sources = new InMemoryContentSourceRepository(), imports = new InMemoryUserImportRepository();
  const service = new ContentSourceService(sources, { enqueue: async () => 'fixture' });
  const source = (await service.getOrCreate('https://youtu.be/dQw4w9WgXcQ')).record;
  await sources.markQueued(source.id, new Date('2026-11-03T00:00:00Z').toISOString());
  await sources.markProcessing(source.id);
  await sources.markReady(source.id, { candidateCount: 0, lastProcessedAt: '2026-11-03T00:01:00Z' });
  const record = await imports.insert({ userId: 'owner', rawInput: source.canonicalUrl!, sourceUrl: source.canonicalUrl!,
    normalizedUrl: source.canonicalUrl!, dedupeKey: 'fixture', platform: 'youtube', contentSourceId: source.id, status: 'RECEIVED' });
  await imports.markTimedOut(record.id, '2026-11-03T00:00:00Z');
  const progress = new InMemoryImportProgressRepository(() => Date.parse('2026-11-03T00:00:30Z'));
  const attempt = await progress.begin(source.id);
  await progress.finish(source.id, attempt.attemptId, 'products', 'complete');
  await progress.finish(source.id, attempt.attemptId, 'places', 'complete');
  await progress.completeEvidence(source.id, attempt.attemptId);
  const snapshot = { foundProducts: 0, foundPlaces: 1, resolvedPlaces: 0, unverifiedPlaces: 1, savedProducts: 0, savedPlaces: 0, missingProducts: 0, missingPlaces: 0,
    snapshot: { source: (await sources.findById(source.id))!, progress: (await progress.get(source.id))!,
      syncState: 'complete' as const, syncAttemptId: attempt.attemptId, startedAt: record.createdAt } };
  const membership = { ...snapshot, selectedProducts: [], outcome: projectFindOutcome(snapshot) };
  const sourcePort = { getOrCreate: service.getOrCreate.bind(service), getById: sources.findById.bind(sources),
    listProducts: sources.listProducts.bind(sources), requestProcessing: service.requestProcessing.bind(service),
    requestReprocessing: service.requestReprocessing.bind(service) };
  const foundation = new UserImportService(imports, sourcePort, null,
    { syncPlaces: async () => {}, memberships: async () => new Map([[record.id, membership]]) });
  const result = (await foundation.listRecent('owner'))[0];
  assert.equal(result.state, 'ready');
  assert.equal(result.findOutcome.category, 'completed'); assert.equal(result.findOutcome.foundPlaces, 1);
  const tables: Record<string, Record<string, unknown>[]> = {
    user_imports: [{ id: record.id, user_id: 'owner', content_source_id: source.id, hidden_at: null, created_at: record.createdAt,
      timed_out_at: '2026-11-03T00:00:00Z', source_url: source.canonicalUrl!, platform: 'youtube' }],
    content_sources: [{ id: source.id, processing_status: 'READY', media_kind: 'VIDEO', candidate_count: 0, queued_at: '2026-11-03T00:00:00Z' }],
    content_source_products: [], user_place_save_sources: [],
    content_source_places: [{ id: 'lead', content_source_id: source.id, place_id: null, retired_at: null }],
    content_source_import_progress: [{ content_source_id: source.id, attempt_id: attempt.attemptId, started_at: attempt.startedAt,
      finished_at: (await progress.get(source.id))?.finishedAt, product_status: 'complete', place_status: 'complete', evidence_complete: true }],
  };
  const db = {
    from(table: string) {
      let rows = tables[table];
      const query = { select() { return query; }, order() { return query; }, limit() { return query; },
        eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return query; },
        neq(k: string, v: unknown) { rows = rows.filter(r => r[k] !== v); return query; },
        is(k: string, v: unknown) { rows = rows.filter(r => (r[k] ?? null) === v); return query; },
        in(k: string, ids: unknown[]) { rows = rows.filter(r => ids.includes(r[k])); return query; },
        then(resolve: (r: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
      }; return query;
    },
    rpc() { return { abortSignal: async () => ({ data: [{ import_id: record.id, saved_products: 0, saved_places: 0, missing_products: 0, missing_places: 0, found_products: 0, found_places: 1, resolved_places: 0, unverified_places: 1, report: membership.snapshot, outcome: membership.outcome, selected_products: [] }], error: null }) }; },
  } as unknown as SupabaseClient;
  assert.deepEqual((await shareHistory(db, 'owner', null, 20)).shares[0].findOutcome, result.findOutcome);
});

test('retrying a save-only failure does not restart capture or extraction', async () => {
  const imports = new InMemoryUserImportRepository(), sources = new InMemoryContentSourceRepository();
  const service = new ContentSourceService(sources, { enqueue: async () => 'fixture' });
  const source = (await service.getOrCreate('https://example.invalid/product')).record;
  const record = await imports.insert({ userId: 'owner', rawInput: source.canonicalUrl!, sourceUrl: source.canonicalUrl!,
    normalizedUrl: source.canonicalUrl!, dedupeKey: 'save-fixture', platform: 'web', contentSourceId: source.id, status: 'RECEIVED' });
  let products = 0, places = 0;
  const boundary = new UserImportService(imports, {
    getOrCreate: service.getOrCreate.bind(service), getById: sources.findById.bind(sources), listProducts: sources.listProducts.bind(sources),
    requestProcessing: async () => { throw new Error('Unexpected processing'); },
    requestReprocessing: async () => { throw new Error('Unexpected extraction retry'); },
  }, { applyIfResolved: async () => { products++; } }, {
    memberships: async () => { const snapshot = { foundProducts: 1, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0,
      savedProducts: 0, savedPlaces: 0, missingProducts: 1, missingPlaces: 0, snapshot: {
        source: { ...source, processingStatus: 'READY' as const }, progress: null, syncState: 'failed' as const, syncAttemptId: null, startedAt: record.createdAt,
      } }; return new Map([[record.id, { ...snapshot, selectedProducts: [], outcome: projectFindOutcome(snapshot) }]]); }, syncPlaces: async () => { places++; },
  });
  await boundary.retry('owner', record.id);
  assert.equal(products, 1); assert.equal(places, 1);
  assert.equal((await imports.findById(record.id))?.attemptStartedAt, record.attemptStartedAt);
  await assert.rejects(boundary.retry('other', record.id), /Import not found/);
});
