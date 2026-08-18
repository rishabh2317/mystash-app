import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapIngestApiProductToDraft } from './ingestApiProductMap';
import { ingestDraftNeedsHydration, reviewVerificationStatus } from './reviewResolution';

describe('mapIngestApiProductToDraft', () => {
  it('carries catalogProductId, resolutionStatus, and merchantUrl from a complete POST', () => {
    const product = mapIngestApiProductToDraft({
      id: 'ext-1',
      name: 'Ray-Ban Meta',
      price: '₹39,900.00',
      provider: 'manual',
      affiliateUrl: '',
      merchantUrl: 'https://amzn.in/d/08CvHpKL',
      catalogProductId: '409f5f02-9a17-423d-8249-c9c54e51a26f',
      resolutionStatus: 'VERIFIED',
      brand: 'Ray-Ban',
    });
    assert.equal(product.catalogProductId, '409f5f02-9a17-423d-8249-c9c54e51a26f');
    assert.equal(product.resolutionStatus, 'VERIFIED');
    assert.equal(product.merchantUrl, 'https://amzn.in/d/08CvHpKL');
    assert.equal(reviewVerificationStatus(product), 'VERIFIED');
    assert.equal(ingestDraftNeedsHydration({ products: [product] }), false);
  });

  it('leaves thin/legacy POST products incomplete so Review hydrates from the backend', () => {
    const product = mapIngestApiProductToDraft({
      id: 'ext-1',
      name: 'Ray-Ban Meta',
      price: '—',
      provider: 'manual',
      affiliateUrl: '',
    });
    assert.equal(product.catalogProductId, undefined);
    assert.equal(product.resolutionStatus, undefined);
    assert.equal(ingestDraftNeedsHydration({ products: [product] }), true);
    assert.equal(reviewVerificationStatus(product), 'RESOLVING');
  });
});
