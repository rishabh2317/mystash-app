import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeNameIsSpecific, placeNameStem } from './placeNameIsSpecific';

describe('placeNameIsSpecific', () => {
  it('discards a generic place type even when the words are capitalized', () => {
    for (const name of ['Cafe', 'Restaurant', 'Hotel', 'Beach', 'Bar', 'Park', 'Mall', 'Shop', 'Store', 'The Hotel']) {
      assert.equal(placeNameIsSpecific(name), false, name);
      assert.deepEqual(placeNameStem(name), []);
    }
  });

  it('keeps a name with a specific token beyond the place type', () => {
    assert.equal(placeNameIsSpecific('Cafe de Flore'), true);
    assert.deepEqual(placeNameStem('Cafe de Flore'), ['flore']);
    assert.equal(placeNameIsSpecific('Seminyak Beach'), true);
    assert.deepEqual(placeNameStem('Seminyak Beach'), ['seminyak']);
    assert.equal(placeNameIsSpecific('Potato Head'), true);
    assert.equal(placeNameIsSpecific('Eiffel Tower'), true);
    assert.deepEqual(placeNameStem('Potato Head Beach Club'), ['potato', 'head']);
  });

  it('does not treat a chain brand as a generic place type', () => {
    assert.equal(placeNameIsSpecific('Starbucks'), true);
  });
});
