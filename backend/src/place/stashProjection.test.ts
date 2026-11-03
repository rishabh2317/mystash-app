import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { PlaceService } from './PlaceService';
import { SupabasePlaceRepository } from './SupabasePlaceRepository';

const source = 'source';
const summary = "The video is titled 'Buckingham Palace London', indicating this landmark.";
async function add(repo: InMemoryPlaceRepository, patch: Parameters<InMemoryPlaceRepository['insertHypothesis']>[0]) {
  const hypothesis = await repo.insertHypothesis(patch);
  const save = await repo.insertLead({ userId: 'owner', contentSourceId: patch.contentSourceId,
    contentSourcePlaceId: hypothesis.id, userImportId: `import:${patch.contentSourceId}` });
  return { hypothesis, save };
}
const buckingham = { contentSourceId: source, extractedName: 'Buckingham Palace', city: 'London', region: 'England',
  country: 'United Kingdom', category: 'Attraction', evidence: { summary }, unresolvedReason: 'category_conflict' as const };

it('groups grounded locality refinement without deleting saves, hypotheses, or source evidence', async () => {
  const repo = new InMemoryPlaceRepository();
  const a = await add(repo, buckingham);
  const b = await add(repo, { ...buckingham, locality: 'Westminster', evidence: {
    summary: "The video is titled 'Buckingham Palace London' and focuses on this landmark in London.",
  } });
  const view = await new PlaceService(repo).listForUser('owner');
  assert.equal(view.items.length, 2, 'legacy API still returns both real records');
  assert.equal(view.displayItemCount, 1);
  assert.ok(view.items[0].presentationGroupId);
  assert.equal(view.items[0].presentationGroupId, view.items[1].presentationGroupId);
  assert.equal(repo.hypotheses.size, 2); assert.equal(repo.saves.size, 2); assert.equal(repo.sources.size, 2);
  assert.deepEqual(new Set(view.items.map(i => i.saveId)), new Set([a.save.id, b.save.id]));
  assert.ok(view.items.every(i => i.kind === 'unresolved'));
});

for (const conflict of ['branch', 'country', 'category', 'evidence', 'source', 'missing-evidence']) {
  it(`does not group a ${conflict} conflict or rely on name similarity`, async () => {
    const repo = new InMemoryPlaceRepository();
    await add(repo, buckingham);
    await add(repo, { ...buckingham, locality: 'Westminster',
      ...(conflict === 'country' ? { country: 'Canada' } : {}),
      ...(conflict === 'category' ? { category: 'Hotel' } : {}),
      ...(conflict === 'evidence' ? { evidence: { summary: 'A separate travel listing mentions this building.' } } : {}),
      ...(conflict === 'source' ? { contentSourceId: 'other-source' } : {}),
      ...(conflict === 'missing-evidence' ? { evidence: {} } : {}),
    });
    if (conflict === 'branch') await add(repo, { ...buckingham, locality: 'Camden' });
    const result = await new PlaceService(repo).listForUser('owner');
    assert.ok(result.items.every(i => i.presentationGroupId === undefined));
    assert.equal(result.displayItemCount, result.items.length);
  });
}

it('pages whole display groups without changing legacy counts, and rejects stale/foreign cursors', async () => {
  const repo = new InMemoryPlaceRepository();
  await add(repo, buckingham); await add(repo, { ...buckingham, locality: 'Westminster' });
  await add(repo, { ...buckingham, contentSourceId: 'other', extractedName: 'Another place' });
  const service = new PlaceService(repo);
  const legacy = await service.listForUser('owner');
  const first = await service.listForUser('owner', { limit: 1 });
  const second = await service.listForUser('owner', { limit: 1, cursor: first.nextCursor! });
  assert.equal(first.itemCount, 3); assert.equal(second.displayItemCount, 2);
  assert.ok(first.nextCursor); assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.items, ...second.items].map(i => i.saveId)), new Set(legacy.items.map(i => i.saveId)));
  assert.ok([first.items.length, second.items.length].includes(2), 'refinements stay on one page');
  await assert.rejects(service.listForUser('other', { limit: 1, cursor: first.nextCursor! }), /refresh/);
  await assert.rejects(service.listForUser('owner', { limit: 0 }), /page size/);
  await assert.rejects(service.listForUser('owner', { limit: 1, cursor: 'invalid' }), /cursor/);
});

it('preserves every authorized source video after canonical promotion, including hidden-history references', async () => {
  const repo = new InMemoryPlaceRepository();
  const canonical = await repo.insertPlace({ provider: 'recorded', providerPlaceId: 'one', name: 'Cafe' });
  for (const id of ['source-a', 'source-b']) {
    const { hypothesis } = await add(repo, { contentSourceId: id, extractedName: 'Cafe', unresolvedReason: 'pending_resolution' });
    await repo.markHypothesisResolved(hypothesis.id, canonical.id);
    repo.setSourceMedia(id, { sourceUrl: id === 'source-a' ? 'https://youtu.be/dQw4w9WgXcQ' : 'https://www.instagram.com/reel/ABC_123/',
      sourceThumbnailUrl: `https://fixture.invalid/${id}.jpg`, frameUrl: null });
  }
  const service = new PlaceService(repo);
  const view = await service.listForUser('owner');
  assert.equal(view.items.length, 1); assert.equal(view.items[0].sources.length, 2);
  assert.equal(view.items[0].sourceVideos?.length, 2);
  assert.ok(view.items[0].sources.every(s => s.sourceVideo?.url));
  assert.deepEqual((await service.listForUser('other')).items, []);
});

type Row = Record<string, unknown>;
function fakeDatabase(tables: Record<string, Row[]>, failCache = false) {
  const reads: { table: string; select: string; filters: [string, unknown][] }[] = [];
  const client = { from(table: string) {
    let fields = '*', from = 0, to = 499, or = '';
    const filters: [string, unknown][] = [];
    const query = {
      select(value: string) { fields = value; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; },
      in(key: string, value: unknown[]) { filters.push([key, value]); return query; },
      order() { return query; },
      or(value: string) { or = value; return query; },
      range(a: number, b: number) { from = a; to = b; return query; },
      then(resolve: (value: unknown) => unknown) {
        reads.push({ table, select: fields, filters });
        if (table === 'video_extraction_cache' && failCache) return Promise.resolve(resolve({ data: null, error: { message: 'unavailable' } }));
        const rows = (tables[table] ?? []).filter(row => filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : value === (row[key] ?? null)))
          .filter(row => !or || [row.url, row.embed_url].some(url => typeof url === 'string' && or.includes(JSON.stringify(url))))
          .slice(from, to + 1).map(row => fields.includes('metadata:') ? { ...row, metadata: (row.payload as { youtubeMetadata?: unknown })?.youtubeMetadata } : row);
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}
function storedFixture(count = 12) {
  return {
    user_place_saves: Array.from({ length: count }, (_, i) => ({ id: `save-${i}`, user_id: 'owner',
      content_source_place_id: `hyp-${i}`, place_id: i === 0 ? 'canonical' : null,
      content_source_id: `source-${i % 8}`, user_import_id: `import-${i}`, created_at: '2026-10-30T00:00:00Z' })),
    user_place_save_sources: Array.from({ length: count }, (_, i) => ({ id: `edge-${i}`, save_id: `save-${i}`, user_id: 'owner',
      content_source_place_id: `hyp-${i}`, content_source_id: `source-${i % 8}`, user_import_id: `import-${i}`, created_at: '2026-10-30T00:00:00Z' })),
    content_source_places: Array.from({ length: count }, (_, i) => ({ id: `hyp-${i}`, content_source_id: `source-${i % 8}`,
      extracted_name: `Place ${i}`, resolution_state: i === 0 ? 'resolved' : 'unresolved', place_id: i === 0 ? 'canonical' : null,
      category: 'Cafe', hypothesis_key: `hyp-${i}`, unresolved_reason: i === 0 ? null : 'ambiguous' })),
    places: [{ id: 'canonical', provider: 'recorded', provider_place_id: 'one', name: 'Place 0', category: 'Cafe' }],
    content_sources: Array.from({ length: 8 }, (_, i) => ({ id: `source-${i}`, platform: 'youtube', external_id: `video-${i}`,
      canonical_url: `https://www.youtube.com/watch?v=video-${i}`, thumbnail_url: null })),
    video_extraction_cache: Array.from({ length: 8 }, (_, i) => ({ platform: 'youtube', external_video_id: `video-${i}`,
      payload: { youtubeMetadata: { thumbnailUrl: `https://fixture.invalid/video-${i}.jpg` } } })),
    videos: [],
  };
}

it('batches a 12-save/eight-source projection into six SELECTs, restores cached images, and makes no writes/providers', async () => {
  const { client, reads } = fakeDatabase(storedFixture());
  const result = await new PlaceService(new SupabasePlaceRepository(client)).listForUser('owner');
  assert.equal(result.items.length, 12); assert.ok(result.items.every(item => item.image?.kind === 'source'));
  assert.equal(reads.length, 6);
  assert.equal(reads.filter(r => r.table === 'content_source_places').length, 1);
  assert.ok(!reads.some(r => r.table === 'videos'));
  const cache = reads.find(r => r.table === 'video_extraction_cache')!;
  assert.match(cache.select, /metadata:payload->youtubeMetadata/); assert.doesNotMatch(cache.select, /\*/);
  const other = await new PlaceService(new SupabasePlaceRepository(client)).listForUser('other');
  assert.equal(other.items.length, 0);
});

it('does not truncate provenance at PostgREST row limits and keeps ID lists bounded', async () => {
  const { client, reads } = fakeDatabase(storedFixture(501));
  const snapshot = await new SupabasePlaceRepository(client).loadStash('owner');
  assert.equal(snapshot.saves.length, 501); assert.equal(snapshot.sources.length, 501); assert.equal(snapshot.hypotheses.length, 501);
  assert.ok(reads.every(read => read.filters.every(([, value]) => !Array.isArray(value) || value.length <= 80)));
});

it('uses exact stored video fallback if cache metadata is unavailable, without using unrelated images', async () => {
  const tables = storedFixture();
  const db: Record<string, Row[]> = { ...tables, videos: [{ id: 'video', url: tables.content_sources[0].canonical_url,
    thumbnail: 'https://fixture.invalid/stored-video.jpg' }, { id: 'wrong', url: 'https://unrelated.invalid', thumbnail: 'https://fixture.invalid/wrong.jpg' }] };
  const { client } = fakeDatabase(db, true);
  const result = await new SupabasePlaceRepository(client).loadStash('owner');
  assert.equal(result.media.get('source-0')?.sourceThumbnailUrl, 'https://fixture.invalid/stored-video.jpg');
  assert.equal(result.media.get('source-0')?.frameUrl, null);
  assert.equal(result.media.get('source-1')?.frameUrl, null);
});


it('retains extracted category evidence when the canonical provider omitted a category', async () => {
  const repo = new InMemoryPlaceRepository();
  const place = await repo.insertPlace({ provider: 'recorded', providerPlaceId: 'one', name: 'Cafe', category: null });
  const { hypothesis } = await add(repo, { ...buckingham, extractedName: 'Cafe', category: 'Cafe' });
  await repo.markHypothesisResolved(hypothesis.id, place.id);
  const item = (await new PlaceService(repo).listForUser('owner')).items[0];
  assert.equal(item.category, 'Cafe'); assert.equal(item.extractedCategory, 'Cafe'); assert.equal(item.categorySource, 'extracted');
});


it('keeps the deployed single-source reader compatible: cache-only historical thumbnails need no source write', async () => {
  const { client, reads } = fakeDatabase(storedFixture());
  const media = await new SupabasePlaceRepository(client).findSourceMedia('source-0');
  assert.equal(media.sourceThumbnailUrl, 'https://fixture.invalid/video-0.jpg');
  assert.equal(media.sourceUrl, 'https://www.youtube.com/watch?v=video-0');
  assert.equal(media.frameUrl, null);
  assert.deepEqual(reads.map(read => read.table), ['content_sources', 'video_extraction_cache']);
});


it('legacy full-list readers also exhaust saved Places and provenance pages before frontend filtering', async () => {
  const { client } = fakeDatabase(storedFixture(1101));
  const repository = new SupabasePlaceRepository(client);
  assert.equal((await repository.listSavesByUser('owner')).length, 1101);
  assert.equal((await repository.listSourcesByUser('owner')).length, 1101);
  assert.equal((await repository.listSavesByUser('other')).length, 0);
});
