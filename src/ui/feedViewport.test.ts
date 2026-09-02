import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clampFeedIndex, feedItemLayout, nextFeedThumbnailUrl, preserveFeedIndex } from './feedViewport';

describe('feedViewport', () => {
  it('builds getItemLayout from viewport height, not window height', () => {
    const viewportH = 640;
    assert.deepEqual(feedItemLayout(viewportH, 0), { length: 640, offset: 0, index: 0 });
    assert.deepEqual(feedItemLayout(viewportH, 2), { length: 640, offset: 1280, index: 2 });
    assert.notEqual(viewportH, 844);
  });

  it('clamps the active index when the feed shrinks', () => {
    assert.equal(clampFeedIndex(4, 3), 2);
    assert.equal(clampFeedIndex(-1, 3), 0);
    assert.equal(clampFeedIndex(1, 0), 0);
  });

  it('preserves the same reel id after an in-place reload', () => {
    assert.equal(
      preserveFeedIndex({
        previousId: 'b',
        previousIndex: 1,
        nextIds: ['x', 'b', 'c'],
      }),
      1,
    );
    assert.equal(
      preserveFeedIndex({
        previousId: 'gone',
        previousIndex: 2,
        nextIds: ['a', 'b'],
      }),
      1,
    );
  });

  it('prefetches only the next reel thumbnail url', () => {
    assert.equal(
      nextFeedThumbnailUrl(
        [{ thumbnail: 'https://cdn.example/a.jpg' }, { thumbnail: 'https://cdn.example/b.jpg' }],
        0,
      ),
      'https://cdn.example/b.jpg',
    );
    assert.equal(
      nextFeedThumbnailUrl([{ thumbnail: 'https://cdn.example/a.jpg' }], 0),
      null,
    );
    assert.equal(
      nextFeedThumbnailUrl(
        [{ thumbnail: 'https://cdn.example/a.jpg' }, { thumbnail: 'not-http' }],
        0,
      ),
      null,
    );
  });
});
