import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mapSearchCollectionCard,
  mapSearchCreatorCard,
  mapSearchProductCardThin,
} from './searchMapper';
import type { SearchResultCard } from '../services/searchApi';

function base(partial: Partial<SearchResultCard> & Pick<SearchResultCard, 'entityType' | 'id'>): SearchResultCard {
  return {
    score: 1,
    title: 'Title',
    subtitle: null,
    imageRef: null,
    ...partial,
  };
}

describe('searchMapper', () => {
  it('maps collection hit id to collectionId (never treats as video)', () => {
    const collectionId = '550e8400-e29b-41d4-a716-446655440000';
    const mapped = mapSearchCollectionCard(
      base({
        entityType: 'collection',
        id: collectionId,
        title: 'Beach fits',
        slug: 'beach-fits',
        productTagCount: 3,
        viewsCount: 42,
        savesCount: 7,
        creator: {
          creatorId: 'creator-1',
          displayName: 'Ada',
          username: 'ada',
          avatarRef: null,
        },
      }),
    );
    assert.ok(mapped);
    assert.equal(mapped.collectionId, collectionId);
    assert.equal(mapped.productCount, 3);
    assert.equal(mapped.counters.views, 42);
    assert.equal(mapped.counters.saves, 7);
    assert.equal(mapped.creator.username, 'ada');
    assert.notEqual(mapped.collectionId, 'video-should-not-appear');
  });

  it('rejects non-collection cards for collection mapper', () => {
    assert.equal(
      mapSearchCollectionCard(base({ entityType: 'product', id: 'p1' })),
      null,
    );
  });

  it('maps creator hit requiring username for profile navigation', () => {
    const mapped = mapSearchCreatorCard(
      base({
        entityType: 'creator',
        id: 'user-1',
        username: 'mystash',
        title: 'Mystash',
        followersCount: 1200,
      }),
    );
    assert.ok(mapped);
    assert.equal(mapped.userId, 'user-1');
    assert.equal(mapped.username, 'mystash');
    assert.equal(mapped.followersCount, 1200);
  });

  it('drops creator hits without username', () => {
    assert.equal(
      mapSearchCreatorCard(
        base({ entityType: 'creator', id: 'user-1', username: null, title: 'X' }),
      ),
      null,
    );
  });

  it('maps product hit id as catalogProductId', () => {
    const catalogProductId = '770e8400-e29b-41d4-a716-446655440099';
    const mapped = mapSearchProductCardThin(
      base({
        entityType: 'product',
        id: catalogProductId,
        title: 'Sony XM5',
        verificationStatus: 'VERIFIED',
        price: 'USD 299',
        priceCurrency: 'USD',
        matchReason: 'Brand: Sony',
      }),
    );
    assert.ok(mapped);
    assert.equal(mapped.catalogProductId, catalogProductId);
    assert.equal(mapped.id, catalogProductId);
    assert.equal(mapped.verificationStatus, 'VERIFIED');
    assert.equal(mapped.price, 'USD 299');
    assert.equal(mapped.shortDescription, 'Brand: Sony');
  });
});
