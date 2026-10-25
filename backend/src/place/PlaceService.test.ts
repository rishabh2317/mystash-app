import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { InMemoryPlaceRepository } from './InMemoryPlaceRepository';
import { PlaceService } from './PlaceService';

const SOURCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const IMPORT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const IMPORT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('PlaceService listForUser', () => {
  it('returns a resolved item with google_search from canonical name and location', async () => {
    const repo = new InMemoryPlaceRepository();
    const place = await repo.insertPlace({
      provider: 'google',
      providerPlaceId: 'ChIJ-potato',
      name: 'Potato Head',
      locality: 'Seminyak',
      formattedAddress: 'Jl. Petitenget, Seminyak',
      latitude: -8.68,
      longitude: 115.15,
      mapsUrl: 'https://maps.google.com/?cid=potato',
    });
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Potato Head',
      unresolvedReason: 'pending_resolution',
      locality: 'Seminyak',
    });
    await repo.markHypothesisResolved(hypothesis.id, place.id);
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: hypothesis.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });

    const view = await new PlaceService(repo).listForUser(USER);
    assert.equal(view.itemCount, 1);
    const item = view.items[0];
    assert.equal(item?.kind, 'resolved');
    if (item?.kind !== 'resolved') return;
    assert.equal(item.placeId, place.id);
    assert.equal(item.name, 'Potato Head');
    assert.equal(item.localityLabel, 'Seminyak');
    assert.equal(item.formattedAddress, 'Jl. Petitenget, Seminyak');
    assert.equal(item.latitude, -8.68);
    assert.equal(item.destination.kind, 'google_search');
    assert.equal(item.destination.query, 'Potato Head Seminyak');
    assert.equal(item.image, null);
    assert.match(item.destination.url, /google\.com\/search\?q=/);
    assert.doesNotMatch(item.destination.url, /maps/);
    assert.doesNotMatch(item.destination.url, /query_place_id/);
    assert.equal('providerPlaceId' in item, false);
    assert.equal('leadId' in item, false);
  });

  it('returns an unresolved lead with extracted fields only', async () => {
    const repo = new InMemoryPlaceRepository();
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Cafe de Flore',
      unresolvedReason: 'name_not_distinctive',
      city: 'Paris',
    });
    const save = await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: hypothesis.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });

    const view = await new PlaceService(repo).listForUser(USER);
    assert.equal(view.itemCount, 1);
    const item = view.items[0];
    assert.equal(item?.kind, 'unresolved');
    if (item?.kind !== 'unresolved') return;
    assert.equal(item.leadId, save.id);
    assert.equal(item.uncertainty, 'insufficient_detail');
    assert.equal(item.locationContext, 'Paris');
    assert.equal(item.destination.kind, 'google_search');
    assert.equal(item.destination.query, 'Cafe de Flore Paris');
    assert.equal('placeId' in item, false);
    assert.equal('formattedAddress' in item, false);
    assert.equal('latitude' in item, false);
    assert.equal(repo.places.size, 0);
  });

  it('marks ambiguous and provider failure as the matching uncertainty', async () => {
    const repo = new InMemoryPlaceRepository();
    const ambiguous = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Eiffel Tower',
      unresolvedReason: 'ambiguous',
    });
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: ambiguous.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });
    const failed = await repo.insertHypothesis({
      contentSourceId: SOURCE_B,
      extractedName: 'Tanah Lot',
      unresolvedReason: 'provider_failed',
    });
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: failed.id,
      contentSourceId: SOURCE_B,
      userImportId: IMPORT_B,
    });
    const view = await new PlaceService(repo).listForUser(USER);
    const byName = Object.fromEntries(view.items.map((item) => [item.name, item]));
    assert.equal(byName['Eiffel Tower']?.kind, 'unresolved');
    if (byName['Eiffel Tower']?.kind === 'unresolved') {
      assert.equal(byName['Eiffel Tower'].uncertainty, 'ambiguous');
      assert.equal(byName['Eiffel Tower'].destination.query, 'Eiffel Tower');
    }
    assert.equal(byName['Tanah Lot']?.kind, 'unresolved');
    if (byName['Tanah Lot']?.kind === 'unresolved') {
      assert.equal(byName['Tanah Lot'].uncertainty, 'unconfirmed');
    }
  });

  it('does not list another user\'s cards', async () => {
    const repo = new InMemoryPlaceRepository();
    const hypothesis = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Cafe de Flore',
      unresolvedReason: 'name_not_distinctive',
    });
    await repo.insertLead({
      userId: OTHER,
      contentSourcePlaceId: hypothesis.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });
    const view = await new PlaceService(repo).listForUser(USER);
    assert.deepEqual(view, { items: [], itemCount: 0 });
  });

  it('exposes an existing source thumbnail, and a video frame when the thumbnail is absent', async () => {
    const repo = new InMemoryPlaceRepository();
    repo.setSourceMedia(SOURCE_A, {
      sourceThumbnailUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
      frameUrl: 'https://cdn.example/frame.jpg',
    });
    const place = await repo.insertPlace({
      provider: 'google',
      providerPlaceId: 'ChIJ-thumb',
      name: 'Potato Head',
    });
    const resolved = await repo.insertHypothesis({
      contentSourceId: SOURCE_A,
      extractedName: 'Potato Head',
      unresolvedReason: 'pending_resolution',
    });
    await repo.markHypothesisResolved(resolved.id, place.id);
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: resolved.id,
      contentSourceId: SOURCE_A,
      userImportId: IMPORT_A,
    });

    repo.setSourceMedia(SOURCE_B, {
      sourceThumbnailUrl: null,
      frameUrl: 'https://cdn.example/reel-frame.jpg',
    });
    const lead = await repo.insertHypothesis({
      contentSourceId: SOURCE_B,
      extractedName: 'Cafe de Flore',
      unresolvedReason: 'name_not_distinctive',
    });
    await repo.insertLead({
      userId: USER,
      contentSourcePlaceId: lead.id,
      contentSourceId: SOURCE_B,
      userImportId: IMPORT_B,
    });

    const view = await new PlaceService(repo).listForUser(USER);
    const byKind = Object.fromEntries(view.items.map((item) => [item.kind, item]));
    assert.deepEqual(byKind.resolved?.image, {
      url: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
      kind: 'source',
    });
    assert.deepEqual(byKind.unresolved?.image, {
      url: 'https://cdn.example/reel-frame.jpg',
      kind: 'frame',
    });
  });
});

describe('place destination source', () => {
  it('does not build Maps urls or read provider place ids', () => {
    const src = readFileSync(join(__dirname, 'placeDestination.ts'), 'utf8');
    assert.doesNotMatch(src, /google_maps|query_place_id|providerPlaceId/);
    assert.match(src, /google_search/);
  });
});
