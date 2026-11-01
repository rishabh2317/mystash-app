import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InMemoryImportProgressRepository, runImportWork } from './ImportProgressRepository';
import { abortImportOperation, assertImportWorkActive, importProviderFetch, importWorkContext,
  importWorkFetch, ImportWorkBusyError, mapImportConcurrent, StaleImportWorkError } from './workContext';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { PlaceResolver } from '../place/PlaceResolver';
import { InMemoryPlaceRepository } from '../place/InMemoryPlaceRepository';
import { searchPlacesWithTimeout } from '../place/PlaceSearchProvider';

it('concurrent claims admit exactly one owner and a released lease can be reused', async () => {
  const progress = new InMemoryImportProgressRepository();
  const claims = await Promise.all([progress.claim('source'), progress.claim('source')]);
  assert.equal(claims.filter(Boolean).length, 1);
  await assert.rejects(runImportWork(progress, 'source', async () => {}), ImportWorkBusyError);
  await progress.release('source', claims.find(Boolean)!.progress.attemptId);
  await runImportWork(progress, 'source', async () => assertImportWorkActive());
});

it('expired worker cannot publish source or place writes, nor release its successor', async () => {
  let now = Date.now();
  const progress = new InMemoryImportProgressRepository(() => now);
  const sources = new InMemoryContentSourceRepository();
  const source = await sources.insert({ platform: 'youtube', externalId: 'fixture', canonicalUrl: 'https://example.invalid',
    mediaKind: 'VIDEO', processingStatus: 'PROCESSING', pipelineVersion: 'fixture' });
  const places = new InMemoryPlaceRepository();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const old = runImportWork(progress, source.id, async () => {
    await gate;
    await sources.markReady(source.id, { lastProcessedAt: new Date().toISOString(), candidateCount: 999 });
  });
  // Let claim complete and the old work enter its context.
  await new Promise((resolve) => setImmediate(resolve));
  now += 61_000;
  const successor = await progress.claim(source.id);
  assert.ok(successor);
  release();
  await assert.rejects(old, StaleImportWorkError);
  assert.equal((await sources.findById(source.id))?.candidateCount, 0);
  assert.equal(await progress.isCurrent(source.id, successor.progress.attemptId), true);
  await importWorkContext.run({ sourceId: source.id, attemptId: 'old', signal: new AbortController().signal,
    owns: () => false }, async () => {
    await assert.rejects(places.insertPlace({ provider: 'fixture', providerPlaceId: 'x', name: 'Late place' }), StaleImportWorkError);
  });
  assert.equal(places.places.size, 0);
});

it('work deadline cancels a non-cooperative SDK wait and releases ownership', async () => {
  const progress = new InMemoryImportProgressRepository();
  await assert.rejects(runImportWork(progress, 'source', () => abortImportOperation(new Promise(() => {})), 5), /deadline exceeded/);
  assert.ok(await progress.claim('source'));
});

it('private lease headers reach Supabase only; ordinary API traffic keeps its headers', async (t) => {
  const original = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_, init) => { requests.push(init ?? {}); return new Response('{}'); };
  t.after(() => { globalThis.fetch = original; });
  await importWorkFetch('https://fixture.invalid/api', { headers: { example: 'plain' } });
  assert.equal(new Headers(requests[0].headers).has('x-mystash-import-attempt'), false);
  await importWorkContext.run({ sourceId: 'source', attemptId: 'attempt', signal: new AbortController().signal }, async () => {
    await importWorkFetch('https://fixture.invalid/database');
    await importProviderFetch('https://fixture.invalid/provider');
  });
  assert.equal(new Headers(requests[1].headers).get('x-mystash-import-attempt'), 'attempt');
  assert.equal(new Headers(requests[2].headers).has('x-mystash-import-attempt'), false);
});

it('bounded concurrency preserves input order and drains started tasks on failure', async () => {
  let active = 0, peak = 0, settled = 0;
  await assert.rejects(mapImportConcurrent([0, 1, 2, 3], 2, async (n) => {
    peak = Math.max(peak, ++active);
    try { await new Promise((resolve) => setImmediate(resolve)); if (!n) throw new Error('fixture failure'); return n; }
    finally { active--; settled++; }
  }), /fixture failure/);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(settled, 2);
});

it('place timeout preserves a lead and parent cancellation does not wait for an ignored signal', async () => {
  const controller = new AbortController();
  const pending = searchPlacesWithTimeout({ name: 'fixture', search: async () => new Promise(() => {}) }, 'q', 8000, controller.signal);
  controller.abort(new Error('cancel fixture'));
  await assert.rejects(pending, /cancel fixture/);
  const places = new InMemoryPlaceRepository();
  await new PlaceResolver(places, { name: 'fixture', search: async () => new Promise(() => {}) }, 5).resolveMentions({
    contentSourceId: 'source', imports: [{ id: 'import', userId: 'user' }], mentions: [{ name: 'Potato Head', locality: 'Seminyak',
      city: null, region: null, country: null, mentionedAddress: null, category: null, confidence: 0.9, evidence: {}, sources: ['METADATA'] }],
  });
  assert.equal((await places.listHypotheses('source'))[0].unresolvedReason, 'provider_failed');
  assert.equal((await places.listSavesByUser('user')).length, 1);
});
