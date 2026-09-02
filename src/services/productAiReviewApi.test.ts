import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchProductAiReview } from '@/src/services/productAiReviewApi';

describe('productAiReviewApi', () => {
  it('returns unavailable when product id is missing', async () => {
    const result = await fetchProductAiReview('  ');
    assert.equal(result.status, 'unavailable');
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'missing_product_id');
    }
  });
});
