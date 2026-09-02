import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FEED_TEACH_COPY,
  feedReelAnnouncement,
  feedThumbnailFadeMs,
  hitSlopToMinTarget,
  productChipAccessibilityLabel,
  shouldShowFeedTeach,
} from './feedA11y';

describe('feedA11y', () => {
  it('names chips as inspect actions', () => {
    assert.equal(
      productChipAccessibilityLabel('Air Max', '$120'),
      'Air Max, $120. View product.',
    );
  });

  it('announces title and creator without empty fragments', () => {
    assert.equal(
      feedReelAnnouncement({ title: 'Summer Drop', creatorName: 'Ada' }),
      'Summer Drop. Ada.',
    );
    assert.equal(feedReelAnnouncement({ title: '  ', creatorName: '' }), '');
  });

  it('shows first-use teach only on reel 1 and never after dismiss', () => {
    assert.equal(
      shouldShowFeedTeach({ dismissed: false, activeIndex: 0, feedReady: true }),
      true,
    );
    assert.equal(
      shouldShowFeedTeach({ dismissed: false, activeIndex: 1, feedReady: true }),
      false,
    );
    assert.equal(
      shouldShowFeedTeach({ dismissed: true, activeIndex: 0, feedReady: true }),
      false,
    );
    assert.equal(
      shouldShowFeedTeach({ dismissed: null, activeIndex: 0, feedReady: true }),
      false,
    );
    assert.match(FEED_TEACH_COPY, /Swipe for the next reel/);
  });

  it('expands hit slop to a 44pt target and shortens reduced-motion fades', () => {
    assert.equal(hitSlopToMinTarget(40), 2);
    assert.equal(hitSlopToMinTarget(44), 0);
    assert.equal(
      feedThumbnailFadeMs({ reduceMotion: false, normalMs: 300, reducedMs: 80 }),
      300,
    );
    assert.equal(
      feedThumbnailFadeMs({ reduceMotion: true, normalMs: 300, reducedMs: 80 }),
      80,
    );
  });
});
