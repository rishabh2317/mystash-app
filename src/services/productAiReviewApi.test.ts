import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchProductAiReview } from '@/src/services/productAiReviewApi';
import { AI_REVIEW_PREVIEW_FIXTURE_ENABLED } from '@/src/services/productAiReviewPreview';

describe('productAiReviewApi', () => {
  it('returns unavailable when product id is missing', async () => {
    const result = await fetchProductAiReview('  ');
    assert.equal(result.status, 'unavailable');
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'missing_product_id');
    }
  });

  it('serves the preview fixture while it is enabled', async () => {
    assert.equal(AI_REVIEW_PREVIEW_FIXTURE_ENABLED, true);
    const result = await fetchProductAiReview('cp-preview');
    assert.equal(result.status, 'available');
    if (result.status === 'available') {
      assert.equal(result.summary.catalogProductId, 'cp-preview');
      assert.ok(result.summary.pros.length > 0);
    }
  });
});
