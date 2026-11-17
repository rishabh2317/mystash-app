import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentSourcePlaceRecord } from '../domain/types';
import { PlaceLeadPhotoService, supabaseOwnedPhotoLead } from './PlaceLeadPhotoService';
import { createPlacePhotoHandler } from './routes';
import type { Request, Response } from 'express';

const lead = { id: '11111111-1111-4111-8111-111111111111', contentSourceId: 'source', extractedName: 'Potato Head', locality: 'Seminyak',
  category: 'beach club', city: null, region: null, country: null, mentionedAddress: null, evidence: {}, placeId: null,
  resolutionState: 'unresolved', retiredAt: null } as ContentSourcePlaceRecord;
const candidate = { providerPlaceId: 'google-venue', name: 'Potato Head', locality: 'Seminyak', category: 'beach club' };

it('uses a unique context-matched venue photo without mutating an unverified lead', async () => {
  const before = structuredClone(lead), queries: string[] = [], ids: string[] = [];
  const service = new PlaceLeadPhotoService(async () => lead, { name: 'google', async search(query) {
    queries.push(query); return { ok: true, candidates: [candidate] };
  } }, { async photo(id) { ids.push(id); return null; } });
  assert.deepEqual(await service.read('owner', lead.id, 256), { image: null, googlePlaceId: 'google-venue' });
  assert.deepEqual(queries, ['Potato Head Seminyak']); assert.deepEqual(ids, ['google-venue']);
  assert.deepEqual(lead, before);
  await service.read('owner', lead.id, 640);
  assert.deepEqual(ids, ['google-venue', 'google-venue'], 'another image size reuses the matched ID');
  assert.equal(queries.length, 1, 'repeat renders do not repeat discovery inside cooldown');
});

it('never requests photos for ambiguous branches, conflicting locality, empty or failed search', async () => {
  for (const candidates of [[], [candidate, { ...candidate, providerPlaceId: 'other-branch' }], [{ ...candidate, locality: 'Paris' }]]) {
    let photos = 0;
    const service = new PlaceLeadPhotoService(async () => lead, { name: 'google', async search() { return { ok: true, candidates }; } },
      { async photo() { photos++; return null; } });
    assert.equal(await service.read('owner', lead.id, 128), null); assert.equal(photos, 0);
  }
  const service = new PlaceLeadPhotoService(async () => lead, { name: 'google', async search() { return { ok: false, reason: 'provider_failed' }; } },
    { async photo() { throw Error('no photo after search failure'); } });
  assert.equal(await service.read('owner', lead.id, 128), null);
});

it('skips discovery for inaccessible, retired, geographic and insufficient-context leads', async () => {
  for (const row of [null, { ...lead, retiredAt: '2026-01-01' }, { ...lead, extractedName: 'India', category: 'country' },
    { ...lead, extractedName: 'Starbucks', locality: null }]) {
    const service = new PlaceLeadPhotoService(async () => row, { name: 'google', async search() { throw Error('must not search'); } },
      { async photo() { throw Error('must not request photo'); } });
    assert.equal(await service.read('stranger', lead.id, 128), null);
  }
});

it('bounds discovery per user and coalesces in-flight widths without retaining provider metadata', async () => {
  let queries = 0, now = 0, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const service = new PlaceLeadPhotoService(async () => lead, { name: 'google', async search() {
    queries++; await barrier; return { ok: true, candidates: [candidate] };
  } }, { async photo() { return null; } }, () => now);
  const a = service.read('owner', 'same-lead', 128), b = service.read('owner', 'same-lead', 256);
  release(); await Promise.all([a, b]); assert.equal(queries, 1);
  for (let i = 0; i < 9; i++) await service.read('owner', `lead-${i}`, 128);
  assert.equal(queries, 6);
  now = 60001; await service.read('owner', 'same-lead', 128); assert.equal(queries, 7);
});

it('authorizes visible Find ownership and exact source before discovery, with no writes', async () => {
  for (const [source, hidden, expected] of [['source', false, true], ['other-source', false, false], ['source', true, false]] as const) {
    const filters: unknown[][] = [];
    const db = { from(table: string) {
      const q = { select() { return q; }, limit() { return q; }, eq(...args: unknown[]) { filters.push(args); return q; },
        is(...args: unknown[]) { filters.push(args); return q; }, async maybeSingle() {
          return { data: table === 'content_source_places' ? { id: lead.id, content_source_id: 'source', extracted_name: lead.extractedName, resolution_state: 'unresolved', evidence: {} }
            : table === 'user_place_save_sources' ? null : hidden ? null : { content_source_id: source }, error: null };
        } }; return q;
    } } as unknown as SupabaseClient;
    assert.equal(Boolean(await supabaseOwnedPhotoLead(db)('owner', lead.id, 'import')), expected);
    assert.ok(filters.some(f => f[0] === 'user_id' && f[1] === 'owner'));
    assert.ok(filters.some(f => f[0] === 'hidden_at' && f[1] === null));
  }
});

it('photo route dispatches lead IDs explicitly and leaves the canonical route intact', async () => {
  let canonical = 0, leads = 0;
  const handler = createPlacePhotoHandler({ authenticate: async () => ({ userId: 'owner' }),
    service: { async read() { canonical++; return { image: null }; } }, leadService: { async read() { leads++; return { image: null }; } } });
  for (const kind of [undefined, 'lead', 'invalid']) {
    let status = 200;
    const res = { setHeader() {}, status(n: number) { status = n; return this; }, json() {} } as unknown as Response;
    await handler({ params: { placeId: lead.id }, query: { kind } } as unknown as Request, res);
    assert.equal(status, kind === 'invalid' ? 400 : 200);
  }
  assert.equal(canonical, 1); assert.equal(leads, 1);
});
