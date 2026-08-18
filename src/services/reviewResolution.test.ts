import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DraftProduct, IngestDraftPayload } from '@/src/types/curation';
import {
  ingestDraftNeedsHydration,
  ingestDraftNeedsProductRetry,
  isPublishableReviewProduct,
  reviewVerificationStatus,
  selectedProductsCanPublish,
} from './reviewResolution';

function product(partial: Partial<DraftProduct> & Pick<DraftProduct, 'id' | 'name'>): DraftProduct {
  return {
    price: '—',
    provider: 'manual',
    affiliateUrl: '',
    ...partial,
  };
}

describe('reviewResolution', () => {
  it('displays VERIFIED from a complete ingest payload without treating it as unresolved', () => {
    const status = reviewVerificationStatus({
      catalogProductId: 'cat-1',
      resolutionStatus: 'VERIFIED',
    });
    assert.equal(status, 'VERIFIED');
    assert.equal(
      ingestDraftNeedsHydration({
        products: [
          product({
            id: 'p1',
            name: 'Ray-Ban',
            catalogProductId: 'cat-1',
            resolutionStatus: 'VERIFIED',
            merchantUrl: 'https://amzn.in/d/08CvHpKL',
          }),
        ],
      }),
      false,
    );
  });

  it('treats a thin/legacy POST payload as needing backend hydration, not UNRESOLVED', () => {
    const thin = product({ id: 'p1', name: 'Ray-Ban' });
    assert.equal(reviewVerificationStatus(thin), 'RESOLVING');
    assert.equal(ingestDraftNeedsHydration({ products: [thin] }), true);
    assert.equal(isPublishableReviewProduct(thin), false);
  });

  it('treats genuine UNRESOLVED (resolver finished without identity) as terminal unresolved', () => {
    const unresolved = product({
      id: 'p1',
      name: 'Unknown',
      catalogProductId: 'placeholder',
      resolutionStatus: 'UNRESOLVED',
    });
    assert.equal(reviewVerificationStatus(unresolved), 'UNRESOLVED');
    assert.equal(isPublishableReviewProduct(unresolved), false);
    assert.equal(ingestDraftNeedsProductRetry({ products: [unresolved] }), true);
  });

  it('does not retry Product Intelligence for already resolved catalog products', () => {
    const draft: Pick<IngestDraftPayload, 'products'> = {
      products: [
        product({
          id: 'p1',
          name: 'Ray-Ban',
          catalogProductId: 'cat-1',
          resolutionStatus: 'VERIFIED',
        }),
      ],
    };
    assert.equal(ingestDraftNeedsProductRetry(draft), false);
    assert.equal(
      ingestDraftNeedsProductRetry({
        products: [
          product({
            id: 'p2',
            name: 'Unverified',
            catalogProductId: 'cat-2',
            resolutionStatus: 'UNVERIFIED',
          }),
        ],
      }),
      false,
    );
  });

  it('allows publish only for selected VERIFIED/UNVERIFIED products with catalog ids', () => {
    const products = [
      product({
        id: 'ok',
        name: 'A',
        catalogProductId: 'cat-1',
        resolutionStatus: 'VERIFIED',
      }),
      product({
        id: 'bad',
        name: 'B',
        resolutionStatus: 'UNRESOLVED',
      }),
    ];
    assert.equal(selectedProductsCanPublish(products, { ok: true }), true);
    assert.equal(selectedProductsCanPublish(products, { ok: true, bad: true }), false);
    assert.equal(selectedProductsCanPublish(products, { bad: true }), false);
    const unverified = product({
      id: 'uv',
      name: 'C',
      catalogProductId: 'cat-2',
      resolutionStatus: 'UNVERIFIED',
    });
    assert.equal(selectedProductsCanPublish([unverified], { uv: true }), true);
    const resolving = product({ id: 'r', name: 'D' });
    assert.equal(selectedProductsCanPublish([resolving], { r: true }), false);
  });
});
