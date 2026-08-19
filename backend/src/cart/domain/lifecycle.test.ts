import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasShoppingDestinationHint,
  isCartableStatus,
  isValidCatalogProductId,
  normalizeCartSource,
  normalizeCatalogProductId,
} from './lifecycle';

describe('cart lifecycle', () => {
  it('validates catalog product ids', () => {
    assert.equal(isValidCatalogProductId('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isValidCatalogProductId(''), false);
    assert.equal(isValidCatalogProductId('https://evil'), false);
    assert.equal(isValidCatalogProductId('../x'), false);
    assert.equal(normalizeCatalogProductId('550e8400-E29B-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
  });

  it('only ACTIVE is cartable for new adds', () => {
    assert.equal(isCartableStatus('ACTIVE'), true);
    assert.equal(isCartableStatus('HIDDEN'), false);
    assert.equal(isCartableStatus('DISCONTINUED'), false);
    assert.equal(isCartableStatus('MERGED'), false);
  });

  it('normalizes optional source without search query', () => {
    assert.equal(normalizeCartSource(null), null);
    assert.equal(normalizeCartSource({}), null);
    const normalized = normalizeCartSource({
      collectionId: '550e8400-e29b-41d4-a716-446655440000',
      surface: 'COLLECTION',
      creatorId: 'not-a-uuid',
    });
    assert.deepEqual(normalized, {
      sourceCollectionId: '550e8400-e29b-41d4-a716-446655440000',
      sourceCreatorId: null,
      sourceCollectionProductTagId: null,
      sourceSurface: 'COLLECTION',
    });
  });

  it('detects shopping destination hints', () => {
    assert.equal(hasShoppingDestinationHint({ merchantUrl: 'https://m.example/p' }), true);
    assert.equal(hasShoppingDestinationHint({ preferredShoppingUrl: null, merchantUrl: null }), false);
  });
});
