import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchPlaceIdentity, type PlaceSearchCandidate } from './placeIdentityMatch';

function hit(partial: Partial<PlaceSearchCandidate> & { providerPlaceId: string; name: string }): PlaceSearchCandidate {
  return {
    providerPlaceId: partial.providerPlaceId,
    name: partial.name,
    locality: partial.locality ?? null,
    city: partial.city ?? null,
    region: partial.region ?? null,
    country: partial.country ?? null,
    category: partial.category ?? null,
    formattedAddress: partial.formattedAddress ?? null,
  };
}

describe('matchPlaceIdentity', () => {
  it('resolves one name-compatible hit in the stated city', () => {
    const decision = matchPlaceIdentity(
      { name: 'Potato Head', locality: 'Seminyak' },
      [hit({ providerPlaceId: 'ChIJ-potato', name: 'Potato Head', locality: 'Seminyak', city: 'Badung' })],
    );
    assert.deepEqual(decision, { outcome: 'resolved', providerPlaceId: 'ChIJ-potato' });
  });

  it('resolves one distinctive name-only hit', () => {
    const decision = matchPlaceIdentity({ name: 'Tanah Lot' }, [
      hit({ providerPlaceId: 'ChIJ-tanah', name: 'Tanah Lot', city: 'Tabanan' }),
    ]);
    assert.equal(decision.outcome, 'resolved');
  });

  it('stays ambiguous when two place ids match the same name', () => {
    const decision = matchPlaceIdentity({ name: 'Potato Head' }, [
      hit({ providerPlaceId: 'ChIJ-a', name: 'Potato Head', city: 'Seminyak' }),
      hit({ providerPlaceId: 'ChIJ-b', name: 'Potato Head Beach Club', city: 'Seminyak' }),
    ]);
    assert.deepEqual(decision, { outcome: 'unresolved', reason: 'ambiguous' });
  });

  it('stays ambiguous when the name matches in two cities and none was stated', () => {
    const decision = matchPlaceIdentity({ name: 'Eiffel Tower' }, [
      hit({ providerPlaceId: 'ChIJ-paris', name: 'Eiffel Tower', city: 'Paris' }),
      hit({ providerPlaceId: 'ChIJ-vegas', name: 'Eiffel Tower', city: 'Las Vegas' }),
    ]);
    assert.deepEqual(decision, { outcome: 'unresolved', reason: 'ambiguous' });
  });

  it('keeps the stated city and drops the other city', () => {
    const decision = matchPlaceIdentity({ name: 'Potato Head', city: 'Seminyak' }, [
      hit({ providerPlaceId: 'ChIJ-right', name: 'Potato Head', city: 'Seminyak' }),
      hit({ providerPlaceId: 'ChIJ-wrong', name: 'Potato Head', city: 'Canggu' }),
    ]);
    assert.deepEqual(decision, { outcome: 'resolved', providerPlaceId: 'ChIJ-right' });
  });

  it('does not accept the only hit when its city conflicts', () => {
    const decision = matchPlaceIdentity({ name: 'Cafe de Flore', city: 'Paris' }, [
      hit({ providerPlaceId: 'ChIJ-lyon', name: 'Cafe de Flore', city: 'Lyon' }),
    ]);
    assert.deepEqual(decision, { outcome: 'unresolved', reason: 'locality_conflict' });
  });

  it('stays unresolved when a chain search returns several branches', () => {
    const decision = matchPlaceIdentity({ name: 'Starbucks', locality: 'Seminyak' }, [
      hit({ providerPlaceId: 'branch-1', name: 'Starbucks', locality: 'Seminyak' }),
      hit({ providerPlaceId: 'branch-2', name: 'Starbucks Coffee', locality: 'Seminyak' }),
    ]);
    assert.deepEqual(decision, { outcome: 'unresolved', reason: 'ambiguous' });
  });

  it('returns no_results when nothing is name-compatible', () => {
    const decision = matchPlaceIdentity({ name: 'Tanah Lot' }, [
      hit({ providerPlaceId: 'ChIJ-other', name: 'Uluwatu Temple', city: 'Pecatu' }),
    ]);
    assert.deepEqual(decision, { outcome: 'unresolved', reason: 'no_results' });
  });

  it('rejects a category that shares no token with the hypothesis', () => {
    const decision = matchPlaceIdentity({ name: 'Potato Head', category: 'beach' }, [
      hit({ providerPlaceId: 'ChIJ-hotel', name: 'Potato Head', category: 'hotel', city: 'Seminyak' }),
    ]);
    assert.deepEqual(decision, { outcome: 'unresolved', reason: 'category_conflict' });
  });

  it('accepts a spelling variant of the same name', () => {
    const decision = matchPlaceIdentity({ name: 'Cafe de Flore', city: 'Paris' }, [
      hit({ providerPlaceId: 'ChIJ-flore', name: 'Café de Flore', city: 'Paris' }),
    ]);
    assert.deepEqual(decision, { outcome: 'resolved', providerPlaceId: 'ChIJ-flore' });
  });
});
