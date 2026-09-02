import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateReviewOutput } from './validateReviewOutput';

describe('validateReviewOutput', () => {
  const grounding = new Set(['https://www.rtings.com/headphones/reviews/sony/wh-1000xm5']);

  it('accepts valid structured output with grounded sources', () => {
    const result = validateReviewOutput(
      {
        summary: 'Solid ANC headphones.',
        pros: [{ text: 'Great ANC', evidence: [{ sourceId: 's1', claim: 'Strong ANC' }] }],
        cons: [],
        sources: [
          {
            id: 's1',
            title: 'RTINGS',
            url: 'https://www.rtings.com/headphones/reviews/sony/wh-1000xm5',
            domain: 'rtings.com',
            publishedAt: null,
          },
        ],
        generatedAt: new Date().toISOString(),
        evidenceLastCheckedAt: new Date().toISOString(),
      },
      grounding,
    );
    assert.equal(result.ok, true);
  });

  it('rejects sources not present in grounding metadata', () => {
    const result = validateReviewOutput(
      {
        summary: 'Test',
        pros: [{ text: 'Pro', evidence: [] }],
        cons: [],
        sources: [
          {
            id: 's1',
            title: 'Fake',
            url: 'https://example.com/fake-review',
            domain: 'example.com',
            publishedAt: null,
          },
        ],
      },
      grounding,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'invalid_source');
  });

  it('rejects malformed payloads without pros or cons', () => {
    const result = validateReviewOutput(
      {
        summary: 'Only summary',
        pros: [],
        cons: [],
        sources: [
          {
            id: 's1',
            title: 'RTINGS',
            url: 'https://www.rtings.com/headphones/reviews/sony/wh-1000xm5',
            domain: 'rtings.com',
            publishedAt: null,
          },
        ],
      },
      grounding,
    );
    assert.equal(result.ok, false);
  });
});
