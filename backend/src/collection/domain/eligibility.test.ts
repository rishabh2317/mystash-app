import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveEligibility } from './eligibility';

describe('deriveEligibility', () => {
  it('marks published public clear collections eligible', () => {
    const e = deriveEligibility({
      status: 'published',
      visibility: 'public',
      moderationState: 'clear',
      deletedAt: null,
    });
    assert.equal(e.feedEligible, true);
    assert.equal(e.searchEligible, true);
    assert.equal(e.recsEligible, true);
  });

  it('excludes private and draft', () => {
    const e = deriveEligibility({
      status: 'draft',
      visibility: 'private',
      moderationState: 'clear',
      deletedAt: null,
    });
    assert.equal(e.feedEligible, false);
  });
});
