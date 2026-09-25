import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hydrateImportShares } from '@/src/services/importShareMap';

describe('hydrateImportShares', () => {
  it('hydrates enriched share progress fields', () => {
    const shares = hydrateImportShares([
      {
        importId: 'i1',
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

  it('tolerates legacy minimal payloads', () => {
    const shares = hydrateImportShares([{ importId: 'i2', state: 'looking', kind: 'web' }]);
    assert.equal(shares[0]?.createdAt, '');
    assert.equal(shares[0]?.productCount, 0);
    assert.equal(shares[0]?.contentSourceId, null);
    assert.equal(shares[0]?.sourceUrl, '');
    assert.equal(shares[0]?.primaryProduct, null);
    assert.deepEqual(shares[0]?.products, []);
  });
});
