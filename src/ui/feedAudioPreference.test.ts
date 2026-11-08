import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { feedMutedSnapshot, setFeedMuted, subscribeFeedMuted } from './feedAudioPreference';

describe('Watch audio preference', () => {
  it('keeps the selected state across subscribers and player remounts', () => {
    setFeedMuted(true);
    let changes = 0;
    const unsubscribe = subscribeFeedMuted(() => { changes += 1; });
    setFeedMuted(false);
    assert.equal(feedMutedSnapshot(), false);
    unsubscribe();
    assert.equal(feedMutedSnapshot(), false);
    assert.equal(changes, 1);
    setFeedMuted(true);
  });
});
