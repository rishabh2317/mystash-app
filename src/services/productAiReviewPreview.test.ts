import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AI_REVIEW_PREVIEW_FIXTURE_ENABLED,
  productAiReviewPreviewFixture,
} from './productAiReviewPreview';

describe('productAiReviewPreviewFixture', () => {
  it('returns a full available summary the card and sheet can render', () => {
    assert.equal(AI_REVIEW_PREVIEW_FIXTURE_ENABLED, true);
    const result = productAiReviewPreviewFixture('cp-1');
    assert.equal(result.status, 'available');
    assert.equal(result.summary.catalogProductId, 'cp-1');
    assert.ok((result.summary.overview ?? '').length > 0);
    assert.ok(result.summary.pros.length >= 3);
    assert.ok(result.summary.cons.length >= 2);
    assert.ok(result.summary.sources.length >= 3);
    for (const source of result.summary.sources) {
      assert.match(source.url, /^https:\/\//);
    }
  });
});
