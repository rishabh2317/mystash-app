import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatEngagementCount } from './formatEngagementCount';

describe('formatEngagementCount', () => {
  it('formats small counts as plain numbers', () => {
    assert.equal(formatEngagementCount(0), '0');
    assert.equal(formatEngagementCount(248), '248');
  });

  it('formats thousands with one decimal when needed', () => {
    assert.equal(formatEngagementCount(1200), '1.2K');
    assert.equal(formatEngagementCount(12400), '12K');
  });
});
