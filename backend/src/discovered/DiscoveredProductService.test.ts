import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DiscoveredProductDraft } from '../product-intelligence/domain/types';
import { DiscoveredProductService } from './DiscoveredProductService';
import { InMemoryDiscoveredProductRepository } from './InMemoryDiscoveredProductRepository';

function draft(partial: Partial<DiscoveredProductDraft> = {}): DiscoveredProductDraft {
  return {
    name: 'Mystery Gadget',
    brand: 'Acme',
    model: 'GX1',
    category: 'gadgets',
    imageUrl: null,
    price: '10',
    currency: 'USD',
    merchant: null,
    merchantUrl: null,
    identityKey: 'n_sameidentitykey000000000001',
    metadata: {},
    matchConfidence: 0.4,
    completeness: null,
    ...partial,
  };
}

describe('DiscoveredProductService', () => {
  it('reuses a row when identity is already stored', async () => {
    const repo = new InMemoryDiscoveredProductRepository();
    const service = new DiscoveredProductService(repo);
    const first = await service.getOrCreate(draft(), 'v1');
    const second = await service.getOrCreate(draft({ name: 'Mystery Gadget refreshed' }), 'v1');
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
    assert.equal(repo.products.size, 1);
  });

  it('never writes catalog_product_id on create', async () => {
    const repo = new InMemoryDiscoveredProductRepository();
    const service = new DiscoveredProductService(repo);
    const { record } = await service.getOrCreate(draft(), 'v1');
    assert.equal(record.catalogProductId, null);
  });
});
