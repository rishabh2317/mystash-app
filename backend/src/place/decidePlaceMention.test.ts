import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidePlaceMention, type PlaceSearchAttempt } from './decidePlaceMention';
import { resolveLeadSearchDestination, resolvePlaceDestination } from './placeDestination';
import type { PlaceSearchCandidate } from './placeIdentityMatch';

function neverSearch(): Promise<PlaceSearchAttempt> {
  throw new Error('search must not be called');
}

describe('decidePlaceMention', () => {
  it('discards a generic name with locality and does not search', async () => {
    const queries: string[] = [];
    const decision = await decidePlaceMention({ name: 'Cafe', locality: 'Seminyak' }, async (query) => {
      queries.push(query);
      return { ok: true, candidates: [] };
    });
    assert.deepEqual(decision, { outcome: 'discarded', reason: 'generic_place_type', searched: false });
    assert.deepEqual(queries, []);
    const beach = await decidePlaceMention({ name: 'Beach' }, neverSearch);
    assert.equal(beach.outcome, 'discarded');
  });

  it('keeps Cafe de Flore and Seminyak Beach as unresolved leads without searching', async () => {
    for (const name of ['Cafe de Flore', 'Seminyak Beach']) {
      const decision = await decidePlaceMention({ name }, neverSearch);
      assert.equal(decision.outcome, 'unresolved');
      if (decision.outcome !== 'unresolved') continue;
      assert.equal(decision.reason, 'name_not_distinctive');
      assert.equal(decision.searched, false);
      assert.equal(decision.query, null);
      assert.equal(decision.destination.kind, 'google_search');
      assert.equal(decision.destination.query, name);
      assert.match(decision.destination.url, /^https:\/\/www\.google\.com\/search\?q=/);
      assert.doesNotMatch(decision.destination.url, /maps/);
    }
  });

  it('searches a distinctive name once and resolves a single hit', async () => {
    const queries: string[] = [];
    const decision = await decidePlaceMention({ name: 'Potato Head', locality: 'Seminyak' }, async (query) => {
      queries.push(query);
      const candidates: PlaceSearchCandidate[] = [
        { providerPlaceId: 'ChIJ-potato', name: 'Potato Head', locality: 'Seminyak' },
      ];
      return { ok: true, candidates };
    });
    assert.deepEqual(queries, ['Potato Head Seminyak']);
    assert.deepEqual(decision, {
      outcome: 'resolved',
      providerPlaceId: 'ChIJ-potato',
      searched: true,
      query: 'Potato Head Seminyak',
    });
  });

  it('keeps an ambiguous name-only result as a lead and does not pick a city', async () => {
    const decision = await decidePlaceMention({ name: 'Eiffel Tower' }, async () => ({
      ok: true,
      candidates: [
        { providerPlaceId: 'ChIJ-paris', name: 'Eiffel Tower', city: 'Paris' },
        { providerPlaceId: 'ChIJ-vegas', name: 'Eiffel Tower', city: 'Las Vegas' },
      ],
    }));
    assert.equal(decision.outcome, 'unresolved');
    if (decision.outcome !== 'unresolved') return;
    assert.equal(decision.reason, 'ambiguous');
    assert.equal(decision.query, 'Eiffel Tower');
    assert.equal(decision.destination.query, 'Eiffel Tower');
    assert.equal('providerPlaceId' in decision, false);
  });

  it('keeps the extracted lead when the provider fails', async () => {
    const decision = await decidePlaceMention({ name: 'Tanah Lot' }, async () => {
      throw new Error('timeout');
    });
    assert.equal(decision.outcome, 'unresolved');
    if (decision.outcome !== 'unresolved') return;
    assert.equal(decision.reason, 'provider_failed');
    assert.equal(decision.searched, true);
    assert.equal(decision.destination.query, 'Tanah Lot');
  });
});

describe('place destinations', () => {
  it('builds Google search for a resolved place from name and stored location', () => {
    const destination = resolvePlaceDestination({
      name: 'Potato Head',
      locality: 'Seminyak',
    });
    assert.equal(destination.kind, 'google_search');
    assert.equal(destination.query, 'Potato Head Seminyak');
    assert.match(destination.url, /^https:\/\/www\.google\.com\/search\?q=/);
    assert.doesNotMatch(destination.url, /maps/);
    assert.doesNotMatch(destination.url, /query_place_id/);
  });

  it('does not invent a location for a name-only resolved place', () => {
    const destination = resolvePlaceDestination({ name: 'Tanah Lot' });
    assert.equal(destination.query, 'Tanah Lot');
  });

  it('builds a Google search from extracted fields only', () => {
    const destination = resolveLeadSearchDestination({
      name: 'Starbucks',
      locality: 'Seminyak',
    });
    assert.equal(destination.kind, 'google_search');
    assert.equal(destination.query, 'Starbucks Seminyak');
    assert.match(destination.url, /google\.com\/search\?q=Starbucks%20Seminyak/);
    assert.doesNotMatch(destination.url, /maps/);
  });
});
