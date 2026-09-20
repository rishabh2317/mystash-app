import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductAiReviewRecord } from '../../ai-review/domain/types';
import { projectReadyReview } from './reviews';

function record(partial: Partial<ProductAiReviewRecord> = {}): ProductAiReviewRecord {
  return {
    id: 'rev-1',
    productId: 'cat-1',
    status: 'READY',
    summary: 'Comfortable everyday headphones.',
    pros: [{ text: 'Comfortable for long sessions', evidence: [] }],
    cons: [{ text: 'Weaker isolation', evidence: [] }],
    sources: [
      {
        id: 's1',
        title: 'TechRadar',
        url: 'https://www.techradar.com/reviews/xm5',
        domain: 'techradar.com',
        publishedAt: null,
      },
    ],
    evidenceLastCheckedAt: '2026-09-01T00:00:00.000Z',
    summaryGeneratedAt: '2026-09-01T00:00:00.000Z',
    evidenceHash: 'hash',
    model: 'gemini',
    errorCode: null,
    errorMessage: null,
    refreshErrorCode: null,
    refreshFailedAt: null,
    refreshNextRetryAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

describe('product page review projection', () => {
  it('projects a READY review without inventing a rating or count', () => {
    const reviews = projectReadyReview(record());
    assert.ok(reviews);
    assert.equal(reviews.overview, 'Comfortable everyday headphones.');
    assert.deepEqual(reviews.likes, ['Comfortable for long sessions']);
    assert.deepEqual(reviews.concerns, ['Weaker isolation']);
    assert.equal(reviews.sources[0]?.name, 'TechRadar');
    assert.equal(reviews.rating, null);
    assert.equal(reviews.reviewCount, null);
    assert.equal(/verif|confidence|generating|failed|gemini/i.test(JSON.stringify(reviews)), false);
  });

  it('omits generating, failed, and empty reviews instead of fabricating them', () => {
    assert.equal(projectReadyReview(record({ status: 'GENERATING', summary: null, pros: [], cons: [] })), null);
    assert.equal(projectReadyReview(record({ status: 'FAILED' })), null);
    assert.equal(projectReadyReview(record({ status: 'READY', summary: '  ', pros: [], cons: [] })), null);
    assert.equal(projectReadyReview(null), null);
  });
});
