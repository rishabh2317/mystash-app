import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyFeedLoadFailure, FEED_COPY, feedFailureCopy } from './feedLoadState';

describe('feedLoadState', () => {
  it('classifies network failures as offline and everything else as error', () => {
    assert.equal(classifyFeedLoadFailure(new Error('Network request failed')), 'offline');
    assert.equal(classifyFeedLoadFailure(new TypeError('Failed to fetch')), 'offline');
    assert.equal(classifyFeedLoadFailure(new Error('permission denied for table videos')), 'error');
  });

  it('never surfaces SQL/RLS in user-facing copy', () => {
    const errorCopy = feedFailureCopy('error');
    const offlineCopy = feedFailureCopy('offline');
    const blob = `${errorCopy.title} ${errorCopy.message} ${offlineCopy.message} ${FEED_COPY.empty.message}`;
    assert.equal(/select|rls|supabase|policy|relation|sql/i.test(blob), false);
    assert.equal(errorCopy.message.includes('permission denied'), false);
  });
});
