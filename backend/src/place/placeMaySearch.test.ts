import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeMaySearch, placeSearchQuery } from './placeMaySearch';

describe('placeMaySearch', () => {
  it('does not search a generic place type, even with a locality', () => {
    for (const name of ['Cafe', 'Restaurant', 'Hotel', 'Beach', 'Bar', 'Park', 'Mall', 'Shop', 'Store', 'The Hotel']) {
      assert.equal(placeMaySearch({ name }), false, name);
      assert.equal(placeMaySearch({ name, locality: 'Seminyak' }), false, name);
      assert.equal(placeSearchQuery({ name, locality: 'Seminyak' }), null, name);
    }
    assert.equal(placeMaySearch({ name: 'Cafe', locality: 'Seminyak', city: 'Badung' }), false);
  });

  it('keeps a single specific token but does not search it without a stated location', () => {
    assert.equal(placeMaySearch({ name: 'Cafe de Flore' }), false);
    assert.equal(placeSearchQuery({ name: 'Cafe de Flore' }), null);
    assert.equal(placeMaySearch({ name: 'Seminyak Beach' }), false);
    assert.equal(placeSearchQuery({ name: 'Seminyak Beach' }), null);
  });

  it('searches a single specific token when a separate location was stated', () => {
    assert.equal(placeMaySearch({ name: 'Cafe de Flore', city: 'Paris' }), true);
    assert.equal(placeSearchQuery({ name: 'Cafe de Flore', city: 'Paris' }), 'Cafe de Flore Paris');
    assert.equal(placeMaySearch({ name: 'Seminyak Beach', region: 'Bali' }), true);
    assert.equal(placeSearchQuery({ name: 'Seminyak Beach', region: 'Bali' }), 'Seminyak Beach Bali');
  });

  it('searches distinctive names with no city and does not append a guessed location', () => {
    for (const name of ['Potato Head', 'Tanah Lot', 'Eiffel Tower', 'Potato Head Beach Club']) {
      assert.equal(placeMaySearch({ name }), true, name);
      assert.equal(placeSearchQuery({ name }), name, name);
    }
  });

  it('does not name-search a chain, and does search it when a locality field is set', () => {
    assert.equal(placeMaySearch({ name: 'Starbucks' }), false);
    assert.equal(placeSearchQuery({ name: 'Starbucks' }), null);
    assert.equal(placeMaySearch({ name: 'Starbucks Seminyak' }), false);
    assert.equal(placeMaySearch({ name: 'Starbucks', locality: 'Seminyak' }), true);
    assert.equal(placeSearchQuery({ name: 'Starbucks', locality: 'Seminyak' }), 'Starbucks Seminyak');
  });

  it('prefers locality over city and does not repeat a location already in the name', () => {
    assert.equal(
      placeSearchQuery({ name: 'Potato Head', locality: 'Petitenget', city: 'Badung' }),
      'Potato Head Petitenget',
    );
    assert.equal(placeSearchQuery({ name: 'Starbucks Seminyak', locality: 'Seminyak' }), 'Starbucks Seminyak');
  });

  it('uses a stated address only when no finer location field exists', () => {
    assert.equal(
      placeSearchQuery({ name: 'Cafe de Flore', mentionedAddress: '172 Boulevard Saint-Germain' }),
      'Cafe de Flore 172 Boulevard Saint-Germain',
    );
  });
});
