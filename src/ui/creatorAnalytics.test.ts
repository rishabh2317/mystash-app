import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  analyticsTotalsAreEmpty,
  collectionAnalyticsLine,
  formatAnalyticsCount,
  rankAnalyticsCollections,
} from './creatorAnalytics';

describe('creator analytics presentation', () => {
  it('treats all-zero totals as an empty dashboard', () => {
    assert.equal(
      analyticsTotalsAreEmpty({ views: 0, followers: 0, saves: 0, shares: 0, productRedirects: 0 }),
      true,
    );
    assert.equal(
      analyticsTotalsAreEmpty({ views: 3, followers: 0, saves: 0, shares: 0, productRedirects: 0 }),
      false,
    );
  });

  it('ranks collections with real activity and hides zero rows', () => {
    const ranked = rankAnalyticsCollections([
      { collectionId: 'a', title: 'A', views: 1, saves: 9, shares: 0, productRedirects: 0 },
      { collectionId: 'b', title: 'B', views: 12, saves: 0, shares: 0, productRedirects: 2 },
      { collectionId: 'c', title: 'C', views: 0, saves: 0, shares: 0, productRedirects: 0 },
    ]);
    assert.deepEqual(
      ranked.map((c) => c.collectionId),
      ['b', 'a'],
    );
  });

  it('formats counts without inventing percentages', () => {
    assert.equal(formatAnalyticsCount(12), '12');
    assert.equal(formatAnalyticsCount(1500), '1.5k');
    assert.equal(collectionAnalyticsLine({ views: 12, saves: 0, productRedirects: 3 }), '12 views · 3 clicks');
  });
});
