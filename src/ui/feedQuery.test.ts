import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FEED_PAGE_SIZE,
  FEED_VIDEO_COLUMNS,
  countMountedFeedPlayers,
  feedHasMore,
  feedPageRange,
  pickActiveFeedIndex,
  shouldMountFeedPlayer,
} from './feedQuery';

describe('feed query', () => {
  it('pages the feed without selecting product detail columns', () => {
    assert.equal(feedPageRange(0).from, 0);
    assert.equal(feedPageRange(0).to, FEED_PAGE_SIZE - 1);
    assert.equal(feedPageRange(2).from, FEED_PAGE_SIZE * 2);
    assert.equal(feedHasMore(FEED_PAGE_SIZE), true);
    assert.equal(feedHasMore(FEED_PAGE_SIZE - 1), false);
    assert.equal(FEED_VIDEO_COLUMNS.includes('thumbnail'), true);
    assert.equal(FEED_VIDEO_COLUMNS.includes('*'), false);
    assert.equal(FEED_VIDEO_COLUMNS.includes('description'), false);
  });

  it('mounts a player only for the active reel that has an embed', () => {
    const flags = [0, 1, 2].map((index) =>
      shouldMountFeedPlayer(index === 1, index === 1 ? 'https://www.youtube.com/embed/abcdefghijk' : ''),
    );
    assert.deepEqual(flags, [false, true, false]);
    assert.equal(countMountedFeedPlayers(flags), 1);
    assert.equal(shouldMountFeedPlayer(true, '   '), false);
    assert.equal(shouldMountFeedPlayer(false, 'https://www.youtube.com/embed/abcdefghijk'), false);
  });

  it('ignores a token that left the viewport when choosing the active reel', () => {
    assert.equal(
      pickActiveFeedIndex([
        { index: 0, isViewable: false },
        { index: 1, isViewable: true, percent: 95 },
      ]),
      1,
    );
    assert.equal(
      pickActiveFeedIndex([
        { index: 4, isViewable: true, percent: 40 },
        { index: 5, isViewable: true, percent: 92 },
      ]),
      5,
    );
    assert.equal(pickActiveFeedIndex([{ index: null, isViewable: true }]), null);
  });
});
