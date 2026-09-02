import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AI_REVIEW_EVIDENCE_TTL_MS, isEvidenceFresh } from './freshness';

describe('ai-review freshness', () => {
  it('treats evidence checked within 90 days as fresh', () => {
    const recent = new Date(Date.now() - AI_REVIEW_EVIDENCE_TTL_MS + 60_000).toISOString();
    assert.equal(isEvidenceFresh(recent), true);
  });

  it('treats evidence older than 90 days as stale', () => {
    const stale = new Date(Date.now() - AI_REVIEW_EVIDENCE_TTL_MS - 1_000).toISOString();
    assert.equal(isEvidenceFresh(stale), false);
  });
});
