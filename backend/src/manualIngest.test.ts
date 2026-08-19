import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapDraftRowToManualApiProduct } from './manualIngest';

describe('mapDraftRowToManualApiProduct', () => {
  it('returns catalogProductId, resolutionStatus, and merchantUrl after successful resolution', () => {
    const product = mapDraftRowToManualApiProduct({
      external_id: 'ext-1',
      name: 'Ray-Ban Meta',
      price: '₹39,900.00',
      currency: 'INR',
      image: 'https://img.example/p.jpg',
      affiliate_url: '',
      provider: 'manual',
      confidence: 1,
      merchant_url: 'https://amzn.in/d/08CvHpKL',
      brand: 'Ray-Ban',
      catalog_product_id: '409f5f02-9a17-423d-8249-c9c54e51a26f',
      resolution_status: 'VERIFIED',
    });
    assert.equal(product.catalogProductId, '409f5f02-9a17-423d-8249-c9c54e51a26f');
    assert.equal(product.resolutionStatus, 'VERIFIED');
    assert.equal(product.merchantUrl, 'https://amzn.in/d/08CvHpKL');
    assert.equal(product.brand, 'Ray-Ban');
    assert.equal(product.name, 'Ray-Ban Meta');
    assert.equal(product.price, '₹39,900.00');
  });

  it('omits invalid resolution/catalog fields instead of inventing UNRESOLVED', () => {
    const product = mapDraftRowToManualApiProduct({
      external_id: 'ext-2',
      name: 'Pending',
      price: '—',
      provider: 'manual',
      confidence: 1,
    });
    assert.equal(product.catalogProductId, undefined);
    assert.equal(product.resolutionStatus, undefined);
    assert.equal(product.merchantUrl, undefined);
  });
});
