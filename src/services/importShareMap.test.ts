import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hydrateImportShares } from '@/src/services/importShareMap';

describe('hydrateImportShares', () => {
  it('hydrates enriched share progress fields', () => {
    const shares = hydrateImportShares([
      {
        importId: 'i1',
        findOutcome: { version: 1, category: 'completed', result: 'found', products: 'complete', places: 'complete',
          foundProducts: 1, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0, savedProducts: 1, savedPlaces: 0, stashSync: 'complete',
          canRetryExtraction: false, canRetrySaving: false, extractionActive: false, delayed: false, finishedAt: null },
        state: 'ready',
        kind: 'instagram',
        createdAt: '2026-09-22T10:00:00.000Z',
        productCount: 1,
        contentSourceId: 'cs1',
        sourceUrl: 'https://www.instagram.com/reel/ABC/',
        primaryProduct: {
          productId: 'p1',
          title: 'Mug',
          imageUrl: 'https://cdn.example.com/mug.jpg',
        },
        products: [
          {
            productId: 'p1',
            title: 'Mug',
            imageUrl: 'https://cdn.example.com/mug.jpg',
          },
        ],
      },
    ]);
    assert.equal(shares.length, 1);
    assert.equal(shares[0]?.sourceUrl, 'https://www.instagram.com/reel/ABC/');
    assert.equal(shares[0]?.products.length, 1);
    assert.equal(shares[0]?.primaryProduct?.productId, 'p1');
  });

  it('rejects a missing outcome rather than applying legacy status rules', () => {
    assert.throws(() => hydrateImportShares([{ importId: 'i2', state: 'looking', kind: 'web' }]), /outcome unavailable/);
  });
});
