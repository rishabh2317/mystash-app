import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hydrateCartLines } from '@/src/services/cartLineMap';
import { hydrateImportShares } from '@/src/services/importShareMap';
import { bagItemFromLine, uniqueBagProductIds } from '@/src/ui/bag';

describe('hydrateCartLines', () => {
  it('hydrates canonical and discovered lines through one CartLine shape', () => {
    const items = hydrateCartLines([
      {
        cartItemId: 'c1',
        catalogProductId: 'cat-1',
        discoveredProductId: null,
        addedAt: '2026-09-20T10:00:00.000Z',
        availability: 'AVAILABLE',
        product: {
          id: 'cat-1',
          catalogProductId: 'cat-1',
          title: 'Canonical lamp',
          brand: 'Flos',
          price: '199.00',
          currency: 'USD',
          category: 'Lighting',
          verificationStatus: 'VERIFIED',
          heroImage: 'https://cdn.example.com/lamp.jpg',
        },
        source: { surface: 'SEARCH' },
      },
      {
        cartItemId: 'c2',
        catalogProductId: null,
        discoveredProductId: 'disc-1',
        addedAt: '2026-09-20T11:00:00.000Z',
        availability: 'NO_DESTINATION',
        product: {
          id: 'disc-1',
          catalogProductId: 'disc-1',
          title: 'Imported stool',
          brand: 'Hay',
          price: '80',
          currency: 'USD',
          category: 'Furniture',
          verificationStatus: 'UNVERIFIED',
          metadataCompleteness: 0.2,
          heroImage: 'https://cdn.example.com/stool.jpg',
        },
        source: {
          surface: 'USER_IMPORT',
          contentSourceId: 'cs-1',
          userImportId: 'imp-1',
        },
      },
    ]);

    assert.equal(items.length, 2);
    assert.equal(items[0]?.productId, 'cat-1');
    assert.equal(items[0]?.catalogProductId, 'cat-1');
    assert.equal(items[0]?.product?.catalogProductId, 'cat-1');
    assert.equal(items[1]?.productId, 'disc-1');
    assert.equal(items[1]?.catalogProductId, null);
    assert.equal(items[1]?.product?.catalogProductId, null);
    assert.equal(items[1]?.product?.category, 'Furniture');
    assert.equal(items[1]?.source?.surface, 'USER_IMPORT');
    assert.equal(items[1]?.source?.contentSourceId, 'cs-1');
    assert.equal(items[1]?.source?.userImportId, 'imp-1');

    const views = items.map(bagItemFromLine);
    assert.equal(views[0]?.title, 'Canonical lamp');
    assert.equal(views[1]?.title, 'Imported stool');
    assert.equal(views[1]?.priceLabel, 'USD 80');
    assert.deepEqual(uniqueBagProductIds(views), ['cat-1', 'disc-1']);
  });

  it('drops lines that are missing both product identities', () => {
    const items = hydrateCartLines([
      { cartItemId: 'c0', addedAt: '2026-09-20T10:00:00.000Z' },
    ]);
    assert.equal(items.length, 0);
  });
});

describe('hydrateImportShares', () => {
  it('keeps Bag-facing share states and drops unknown rows', () => {
    const shares = hydrateImportShares([
      { importId: 'i1', state: 'looking', kind: 'instagram' },
      { importId: 'i2', state: 'ready', kind: 'youtube' },
      { importId: 'bad', state: 'QUEUED', kind: 'web' },
      { state: 'looking' },
    ]);
    assert.equal(shares.length, 2);
    assert.equal(shares[0]?.kind, 'instagram');
    assert.equal(shares[1]?.state, 'ready');
    assert.equal(
      JSON.stringify(shares).includes('QUEUED'),
      false,
    );
  });
});
