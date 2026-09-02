import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  creatorDisplayNameFromFeed,
  creatorProfileHref,
  creatorUsernameFromFeed,
  isLikelyUserId,
  shouldShowFeedFollow,
} from './feedCreatorIdentity';

describe('feedCreatorIdentity', () => {
  it('parses @handle curator_id into a profile username', () => {
    assert.equal(creatorUsernameFromFeed({ curator_id: '@ada' }), 'ada');
    assert.equal(creatorProfileHref('ada'), '/creator/ada');
  });

  it('does not treat a UUID curator_id as a tappable username', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    assert.equal(isLikelyUserId(id), true);
    assert.equal(creatorUsernameFromFeed({ curator_id: id }), null);
  });

  it('prefers display name over handle for the identity label', () => {
    assert.equal(
      creatorDisplayNameFromFeed({ curator_id: '@ada', creator_name: 'Ada Lovelace' }),
      'Ada Lovelace',
    );
    assert.equal(creatorDisplayNameFromFeed({ curator_id: '@ada', creator_name: '' }), '@ada');
  });

  it('hides Follow until a creator UUID exists, and never for self', () => {
    assert.equal(shouldShowFeedFollow({ creatorId: null, isSelf: false }), false);
    assert.equal(shouldShowFeedFollow({ creatorId: '   ', isSelf: false }), false);
    assert.equal(shouldShowFeedFollow({ creatorId: 'user-uuid', isSelf: true }), false);
    assert.equal(shouldShowFeedFollow({ creatorId: 'user-uuid', isSelf: false }), true);
  });
});
