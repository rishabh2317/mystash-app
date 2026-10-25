import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitReasonerPayload } from './parseReasonerPayload';

const MUG = {
  name: 'Ceramic Mug',
  category: 'home',
  brand: null,
  model: null,
  confidence: 0.8,
  evidence: { summary: 'shown' },
  sources: ['VISION'],
};

describe('splitReasonerPayload', () => {
  it('keeps products when the payload also contains places', () => {
    const split = splitReasonerPayload(
      JSON.stringify({
        products: [MUG],
        places: [
          {
            name: 'Potato Head',
            category: 'beach',
            locality: 'Seminyak',
            confidence: 0.7,
            evidence: { summary: 'title' },
            sources: ['METADATA'],
            providerPlaceId: 'should-not-copy',
            latitude: -8.6,
            rating: 4.5,
          },
        ],
      }),
    );
    assert.equal(split.products.length, 1);
    assert.equal(split.products[0]?.name, 'Ceramic Mug');
    assert.equal(split.places.length, 1);
    assert.equal(split.places[0]?.name, 'Potato Head');
    assert.equal(split.places[0]?.locality, 'Seminyak');
    assert.deepEqual(split.places[0]?.evidence, { summary: 'title' });
    assert.deepEqual(Object.keys(split.places[0] ?? {}), [
      'name',
      'category',
      'locality',
      'city',
      'region',
      'country',
      'mentionedAddress',
      'confidence',
      'evidence',
      'sources',
    ]);
  });

  it('parses a product-only payload as an empty place list', () => {
    const split = splitReasonerPayload(JSON.stringify({ products: [MUG] }));
    assert.equal(split.products.length, 1);
    assert.deepEqual(split.places, []);
  });

  it('drops a place object that has no name and ignores invalid JSON', () => {
    const split = splitReasonerPayload(
      JSON.stringify({ products: [MUG], places: [{ category: 'cafe' }, null, 'Beach'] }),
    );
    assert.equal(split.products.length, 1);
    assert.deepEqual(split.places, []);
    assert.deepEqual(splitReasonerPayload('not json'), { products: [], places: [] });
  });
});
