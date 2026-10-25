import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { placeHypothesisKey } from './domain/hypothesisKey';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { PlaceRepositoryError } from './PlaceRepository';

const SOURCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '11111111-1111-4111-8111-111111111111';
const IMPORT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const IMPORT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('place migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/20260930150000_places.sql'),
    'utf8',
  );

  it('creates only the place tables and does not alter product tables', () => {
    assert.match(sql, /create table if not exists public\.places/i);
    assert.match(sql, /create table if not exists public\.content_source_places/i);
    assert.match(sql, /create table if not exists public\.user_place_saves/i);
    assert.match(sql, /user_place_saves_user_place_unique/);
    assert.doesNotMatch(sql, /alter table\s+public\.(cart_items|discovered_products|content_source_products)/i);
    assert.doesNotMatch(sql, /insert into\s+public\.(places|content_source_places|user_place_saves)/i);
  });
});

describe('placeHypothesisKey', () => {
  it('ignores empty location fields and keeps stated ones', () => {
    assert.equal(
      placeHypothesisKey({ extractedName: ' Potato Head ' }),
      placeHypothesisKey({ extractedName: 'potato head', locality: '  ' }),
    );
    assert.notEqual(
      placeHypothesisKey({ extractedName: 'Potato Head', locality: 'Seminyak' }),
      placeHypothesisKey({ extractedName: 'Potato Head' }),
    );
  });
});

describe('InMemoryPlaceRepository', () => {
  it('stores an unresolved lead without a canonical place', async () => {
    const repo = new InMemoryPlaceRepository();
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Cafe de Flore',
      unresolvedReason: 'name_not_distinctive',
    });
    assert.equal(hypothesis.placeId, null);
    assert.equal(hypothesis.resolutionState, 'unresolved');
    assert.equal(repo.places.size, 0);

    const lead = await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: hypothesis.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });
    assert.equal(lead.placeId, null);
    assert.equal(await repo.countByUserImport(IMPORT_A), 1);
  });

  it('rejects a second canonical row for the same provider place id', async () => {
    const repo = new InMemoryPlaceRepository();
    await repo.insertPlace({
      provider: 'google',
      providerPlaceId: 'ChIJ-potato',
      name: 'Potato Head',
      city: 'Seminyak',
    });
    await assert.rejects(
      () =>
        repo.insertPlace({
          provider: 'google',
          providerPlaceId: 'ChIJ-potato',
          name: 'Potato Head Beach Club',
        }),
      (err: unknown) => err instanceof PlaceRepositoryError && err.code === 'duplicate',
    );
  });

  it('resolves one lead and merges a second lead onto the same canonical place', async () => {
    const repo = new InMemoryPlaceRepository();
    const first = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Potato Head',
      unresolvedReason: 'ambiguous',
    });
    const second = await repo.insertHypothesis({
      contentSourceId: SOURCE_B,
      extractedName: 'Potato Head',
      unresolvedReason: 'ambiguous',
    });
    const leadA = await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: first.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });
    const leadB = await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: second.id,
      contentSourceId: SOURCE_B,
      userImportId: IMPORT_B,
    });

    const place = await repo.insertPlace({
      provider: 'google',
      providerPlaceId: 'ChIJ-potato',
      name: 'Potato Head',
      mapsUrl: 'https://maps.google.com/?cid=1',
    });
    const upgraded = await repo.upgradeLead(leadA.id, place.id);
    assert.equal(upgraded.merged, false);
    assert.equal(upgraded.save.placeId, place.id);
    const hypothesis = await repo.findHypothesis(SOURCE_A, first.hypothesisKey);
    assert.equal(hypothesis?.resolutionState, 'resolved');
    assert.equal(hypothesis?.placeId, place.id);
    assert.equal(hypothesis?.unresolvedReason, null);

    const merged = await repo.upgradeLead(leadB.id, place.id);
    assert.equal(merged.merged, true);
    assert.equal(merged.save.id, leadA.id);
    assert.equal(await repo.findSaveByUserAndHypothesis(USER, second.id), null);
    assert.equal((await repo.listSavesByUser(USER)).length, 1);
  });

  it('keeps two unresolved leads when the names are not yet the same place', async () => {
    const repo = new InMemoryPlaceRepository();
    const first = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Potato Head',
      unresolvedReason: 'ambiguous',
    });
    const second = await repo.insertHypothesis({
      contentSourceId: SOURCE_B,
      extractedName: 'Potato Head',
      unresolvedReason: 'no_results',
    });
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: first.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: second.id,
      contentSourceId: SOURCE_B,
      userImportId: IMPORT_B,
    });
    assert.equal((await repo.listSavesByUser(USER)).length, 2);
    assert.equal(repo.places.size, 0);
  });

  it('does not clear a resolved place id when the hypothesis is reprocessed', async () => {
    const repo = new InMemoryPlaceRepository();
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Tanah Lot',
      unresolvedReason: 'provider_failed',
    });
    const place = await repo.insertPlace({
      provider: 'google',
      providerPlaceId: 'ChIJ-tanah',
      name: 'Tanah Lot',
    });
    await repo.markHypothesisResolved(hypothesis.id, place.id);
    const again = await repo.upsertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Tanah Lot',
      unresolvedReason: 'provider_failed',
      category: 'temple',
    });
    assert.equal(again.id, hypothesis.id);
    assert.equal(again.placeId, place.id);
    assert.equal(again.resolutionState, 'resolved');
    assert.equal(again.unresolvedReason, null);
    assert.equal(again.category, 'temple');
  });

  it('updates the unresolved reason on reprocess and does not clear a resolved row', async () => {
    const repo = new InMemoryPlaceRepository();
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Eiffel Tower',
      unresolvedReason: 'pending_resolution',
    });
    const updated = await repo.upsertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Eiffel Tower',
      unresolvedReason: 'ambiguous',
    });
    assert.equal(updated.id, hypothesis.id);
    assert.equal(updated.resolutionState, 'unresolved');
    assert.equal(updated.unresolvedReason, 'ambiguous');
    assert.equal(updated.placeId, null);
  });

  it('refuses to resolve a hypothesis onto a missing place', async () => {
    const repo = new InMemoryPlaceRepository();
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Eiffel Tower',
      unresolvedReason: 'ambiguous',
    });
    await assert.rejects(
      () => repo.markHypothesisResolved(hypothesis.id, 'missing-place'),
      (err: unknown) => err instanceof PlaceRepositoryError && err.code === 'invalid',
    );
    assert.equal(repo.places.size, 0);
  });
});
