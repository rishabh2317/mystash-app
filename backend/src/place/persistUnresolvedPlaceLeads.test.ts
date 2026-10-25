import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExtractedPlaceMention } from './parseReasonerPayload';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { persistUnresolvedPlaceLeads } from './persistUnresolvedPlaceLeads';

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
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
    confidence: partial.confidence ?? null,
    evidence: partial.evidence ?? {},
    sources: partial.sources ?? [],
  };
}

describe('persistUnresolvedPlaceLeads', () => {
  it('drops a generic name with locality and keeps a specific unresolved lead', async () => {
    const repository = new InMemoryPlaceRepository();
    const result = await persistUnresolvedPlaceLeads({
      repository,
      contentSourceId: SOURCE,
      imports: [{ id: IMPORT_A, userId: USER_A }],
      mentions: [
        mention({ name: 'Cafe', locality: 'Seminyak', category: 'cafe' }),
        mention({ name: 'Beach' }),
        mention({ name: 'Cafe de Flore', city: 'Paris' }),
        mention({ name: 'Seminyak Beach' }),
        mention({ name: 'Potato Head' }),
        mention({ name: 'Eiffel Tower' }),
      ],
    });

    assert.equal(result.discarded, 2);
    assert.equal(result.kept, 4);
    assert.equal(result.leads, 4);
    assert.equal(repository.places.size, 0);
    const names = (await repository.listHypotheses(SOURCE)).map((row) => row.extractedName);
    assert.deepEqual(names, ['Cafe de Flore', 'Seminyak Beach', 'Potato Head', 'Eiffel Tower']);
    for (const row of await repository.listHypotheses(SOURCE)) {
      assert.equal(row.placeId, null);
      assert.equal(row.resolutionState, 'unresolved');
      assert.equal(row.unresolvedReason, 'pending_resolution');
    }
    const saves = await repository.listSavesByUser(USER_A);
    assert.equal(saves.length, 4);
    assert.ok(saves.every((row) => row.placeId === null));
  });

  it('writes one hypothesis and one lead per user for the same content', async () => {
    const repository = new InMemoryPlaceRepository();
    await persistUnresolvedPlaceLeads({
      repository,
      contentSourceId: SOURCE,
      imports: [
        { id: IMPORT_A, userId: USER_A },
        { id: IMPORT_B, userId: USER_B },
      ],
      mentions: [mention({ name: 'Tanah Lot' })],
    });
    assert.equal((await repository.listHypotheses(SOURCE)).length, 1);
    assert.equal((await repository.listSavesByUser(USER_A)).length, 1);
    assert.equal((await repository.listSavesByUser(USER_B)).length, 1);
    assert.equal(repository.places.size, 0);
  });

  it('removes an unresolved lead that a reprocess no longer extracted', async () => {
    const repository = new InMemoryPlaceRepository();
    const imports = [{ id: IMPORT_A, userId: USER_A }];
    await persistUnresolvedPlaceLeads({
      repository,
      contentSourceId: SOURCE,
      imports,
      mentions: [mention({ name: 'Potato Head' }), mention({ name: 'Tanah Lot' })],
    });
    await persistUnresolvedPlaceLeads({
      repository,
      contentSourceId: SOURCE,
      imports,
      mentions: [mention({ name: 'Potato Head' })],
    });
    const names = (await repository.listHypotheses(SOURCE)).map((row) => row.extractedName);
    assert.deepEqual(names, ['Potato Head']);
    assert.equal((await repository.listSavesByUser(USER_A)).length, 1);
    assert.equal(repository.places.size, 0);
  });
});
