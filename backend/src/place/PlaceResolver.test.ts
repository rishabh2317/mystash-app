import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlaceSearchAttempt } from './decidePlaceMention';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { PlaceResolver } from './PlaceResolver';
import type { PlaceSearchProvider } from './PlaceSearchProvider';
import type { ExtractedPlaceMention } from './parseReasonerPayload';
import type { PlaceSearchCandidate } from './placeIdentityMatch';

const SOURCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '11111111-1111-4111-8111-111111111111';
const IMPORT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const IMPORT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function mention(partial: Partial<ExtractedPlaceMention> & { name: string }): ExtractedPlaceMention {
  return {
    name: partial.name,
    category: partial.category ?? null,
    locality: partial.locality ?? null,
    city: partial.city ?? null,
    region: partial.region ?? null,
    country: partial.country ?? null,
    mentionedAddress: partial.mentionedAddress ?? null,
    confidence: partial.confidence ?? 0.8,
    evidence: partial.evidence ?? {},
    sources: partial.sources ?? ['TRANSCRIPT'],
  };
}

function provider(respond: (query: string, signal?: AbortSignal) => Promise<PlaceSearchAttempt>): PlaceSearchProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    name: 'google',
    queries,
    search(query, signal) {
      queries.push(query);
      return respond(query, signal);
    },
  };
}

function hit(partial: Partial<PlaceSearchCandidate> & { providerPlaceId: string; name: string }): PlaceSearchCandidate {
  return partial;
}

describe('PlaceResolver', () => {
  it('discards a generic place type and does not search or write', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => {
      throw new Error('search must not be called');
    });
    const summary = await new PlaceResolver(repo, search).resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Cafe', locality: 'Seminyak' }), mention({ name: 'Beach' })],
    });
    assert.deepEqual(summary, { kept: 0, discarded: 2, leads: 0, resolved: 0 });
    assert.deepEqual(search.queries, []);
    assert.equal(repo.places.size, 0);
    assert.equal((await repo.listHypotheses(SOURCE_A)).length, 0);
    assert.equal((await repo.listSavesByUser(USER)).length, 0);
  });

  it('keeps Cafe de Flore and Seminyak Beach as unresolved leads without searching', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => {
      throw new Error('search must not be called');
    });
    const summary = await new PlaceResolver(repo, search).resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Cafe de Flore' }), mention({ name: 'Seminyak Beach' })],
    });
    assert.equal(summary.kept, 2);
    assert.equal(summary.resolved, 0);
    assert.equal(summary.leads, 2);
    assert.deepEqual(search.queries, []);
    assert.equal(repo.places.size, 0);
    const hypotheses = await repo.listHypotheses(SOURCE_A);
    assert.deepEqual(
      hypotheses.map((row) => row.unresolvedReason),
      ['name_not_distinctive', 'name_not_distinctive'],
    );
    assert.ok(hypotheses.every((row) => row.placeId === null && row.resolutionState === 'unresolved'));
  });

  it('creates one canonical place when a distinctive name has one compatible hit', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => ({
      ok: true,
      candidates: [
        hit({
          providerPlaceId: 'ChIJ-potato',
          name: 'Potato Head',
          locality: 'Seminyak',
          latitude: -8.68,
          longitude: 115.15,
          mapsUrl: 'https://maps.google.com/?cid=potato',
        }),
      ],
    }));
    const summary = await new PlaceResolver(repo, search).resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Potato Head', locality: 'Seminyak', category: 'beach' })],
    });
    assert.equal(summary.resolved, 1);
    assert.equal(summary.leads, 0);
    assert.deepEqual(search.queries, ['Potato Head Seminyak']);
    assert.equal(repo.places.size, 1);
    const place = [...repo.places.values()][0];
    assert.equal(place?.provider, 'google');
    assert.equal(place?.providerPlaceId, 'ChIJ-potato');
    assert.equal(place?.latitude, -8.68);
    assert.equal(place?.longitude, 115.15);
    assert.equal(place?.mapsUrl, 'https://maps.google.com/?cid=potato');
    const hypothesis = (await repo.listHypotheses(SOURCE_A))[0];
    assert.equal(hypothesis?.resolutionState, 'resolved');
    assert.equal(hypothesis?.unresolvedReason, null);
    assert.equal(hypothesis?.placeId, place?.id);
    const saves = await repo.listSavesByUser(USER);
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.placeId, place?.id);
  });

  it('does not write a canonical place when the name matches two cities', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => ({
      ok: true,
      candidates: [
        hit({ providerPlaceId: 'ChIJ-paris', name: 'Eiffel Tower', city: 'Paris' }),
        hit({ providerPlaceId: 'ChIJ-vegas', name: 'Eiffel Tower', city: 'Las Vegas' }),
      ],
    }));
    await new PlaceResolver(repo, search).resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Eiffel Tower' })],
    });
    assert.deepEqual(search.queries, ['Eiffel Tower']);
    assert.equal(repo.places.size, 0);
    const hypothesis = (await repo.listHypotheses(SOURCE_A))[0];
    assert.equal(hypothesis?.unresolvedReason, 'ambiguous');
    assert.equal(hypothesis?.placeId, null);
    assert.equal((await repo.listSavesByUser(USER))[0]?.placeId, null);
  });

  it('keeps the lead when the provider fails or times out and writes no canonical place', async () => {
    const repo = new InMemoryPlaceRepository();
    const failed = provider(async () => ({ ok: false, reason: 'provider_failed' }));
    await new PlaceResolver(repo, failed).resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Tanah Lot' })],
    });
    assert.equal(repo.places.size, 0);
    assert.equal((await repo.listHypotheses(SOURCE_A))[0]?.unresolvedReason, 'provider_failed');

    const slow = provider((query, signal) => {
      assert.equal(query, 'Tanah Lot');
      return new Promise<PlaceSearchAttempt>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('late')), 1000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    });
    await new PlaceResolver(repo, slow, 20).resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Tanah Lot' })],
    });
    assert.equal(repo.places.size, 0);
    assert.equal((await repo.listHypotheses(SOURCE_A))[0]?.unresolvedReason, 'provider_failed');
    assert.equal((await repo.listSavesByUser(USER)).length, 1);
  });

  it('reuses one places row and one user card for the same provider place id', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => ({
      ok: true,
      candidates: [hit({ providerPlaceId: 'ChIJ-potato', name: 'Potato Head', locality: 'Seminyak' })],
    }));
    const resolver = new PlaceResolver(repo, search);
    const imports = { mentions: [mention({ name: 'Potato Head', locality: 'Seminyak' })] };
    await resolver.resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      ...imports,
    });
    await resolver.resolveMentions({
      contentSourceId: SOURCE_B,
      imports: [{ id: IMPORT_B, userId: USER }],
      ...imports,
    });
    assert.equal(repo.places.size, 1);
    const placeId = [...repo.places.values()][0]?.id;
    assert.equal((await repo.listHypotheses(SOURCE_A))[0]?.placeId, placeId);
    assert.equal((await repo.listHypotheses(SOURCE_B))[0]?.placeId, placeId);
    const saves = await repo.listSavesByUser(USER);
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.placeId, placeId);
  });

  it('upgrades an unresolved lead when a later match is unambiguous', async () => {
    const repo = new InMemoryPlaceRepository();
    const responses: PlaceSearchAttempt[] = [
      {
        ok: true,
        candidates: [
          hit({ providerPlaceId: 'ChIJ-a', name: 'Potato Head', locality: 'Seminyak' }),
          hit({ providerPlaceId: 'ChIJ-b', name: 'Potato Head', locality: 'Seminyak' }),
        ],
      },
      {
        ok: true,
        candidates: [hit({ providerPlaceId: 'ChIJ-a', name: 'Potato Head', locality: 'Seminyak' })],
      },
    ];
    const search = provider(async () => responses.shift() ?? { ok: false, reason: 'provider_failed' });
    const resolver = new PlaceResolver(repo, search);
    const input = {
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Potato Head', locality: 'Seminyak' })],
    };
    await resolver.resolveMentions(input);
    assert.equal(repo.places.size, 0);
    assert.equal((await repo.listSavesByUser(USER))[0]?.placeId, null);
    await resolver.resolveMentions(input);
    assert.equal(repo.places.size, 1);
    const placeId = [...repo.places.values()][0]?.id;
    const saves = await repo.listSavesByUser(USER);
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.placeId, placeId);
    assert.equal((await repo.listHypotheses(SOURCE_A))[0]?.resolutionState, 'resolved');
  });

  it('does not stack a second lead when the same content is reprocessed', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => {
      throw new Error('search must not be called');
    });
    const resolver = new PlaceResolver(repo, search);
    const input = {
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Cafe de Flore' })],
    };
    await resolver.resolveMentions(input);
    await resolver.resolveMentions(input);
    assert.equal((await repo.listHypotheses(SOURCE_A)).length, 1);
    assert.equal((await repo.listSavesByUser(USER)).length, 1);
    assert.deepEqual(search.queries, []);
  });

  it('drops a generic name that replaces a previous unresolved lead', async () => {
    const repo = new InMemoryPlaceRepository();
    const search = provider(async () => {
      throw new Error('search must not be called');
    });
    const resolver = new PlaceResolver(repo, search);
    await resolver.resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Cafe de Flore' })],
    });
    await resolver.resolveMentions({
      contentSourceId: SOURCE_A,
      imports: [{ id: IMPORT_A, userId: USER }],
      mentions: [mention({ name: 'Cafe', locality: 'Seminyak' })],
    });
    assert.equal((await repo.listHypotheses(SOURCE_A)).length, 0);
    assert.equal((await repo.listSavesByUser(USER)).length, 0);
    assert.equal(repo.places.size, 0);
  });
});
