import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPlaybackTrace,
  notePlayerMounted,
  notePlayerReleased,
  playbackDurations,
  playbackPlayerCount,
  recordPlaybackMark,
  resetPlaybackPlayerCount,
  shouldRevealFeedFrame,
  shouldRevealYoutubePoster,
} from './feedPlaybackTiming';

describe('feed playback timing', () => {
  it('measures active → mount → load → first frame without treating document load as the frame', () => {
    const trace = createPlaybackTrace('youtube', 'abcdefghijk');
    recordPlaybackMark(trace, 'active', 1_000);
    recordPlaybackMark(trace, 'mount', 1_020);
    recordPlaybackMark(trace, 'loadEnd', 1_400);
    recordPlaybackMark(trace, 'firstFrame', 2_600);
    recordPlaybackMark(trace, 'firstFrame', 9_000);

    assert.deepEqual(playbackDurations(trace), {
      activeToMountMs: 20,
      mountToLoadEndMs: 380,
      loadEndToFirstFrameMs: 1200,
      activeToFirstFrameMs: 1600,
    });
    assert.equal(trace.marks.firstFrame, 2_600);
    assert.equal(shouldRevealFeedFrame('loadEnd'), false);
    assert.equal(shouldRevealFeedFrame('iframeLoaded'), false);
    assert.equal(shouldRevealFeedFrame('firstFrame'), true);
  });

  it('lifts the YouTube poster on iframe load even when firstFrame never arrives', () => {
    assert.equal(shouldRevealYoutubePoster('iframeLoaded'), true);
    assert.equal(shouldRevealYoutubePoster('firstFrame'), false);
    assert.equal(shouldRevealYoutubePoster('loadEnd'), false);
    assert.equal(shouldRevealYoutubePoster('playerVisible'), false);
  });

  it('releases inactive players so the mounted count does not grow across reels', () => {
    resetPlaybackPlayerCount();
    assert.equal(notePlayerMounted(), 1);
    assert.equal(notePlayerReleased(), 0);
    for (let i = 0; i < 10; i += 1) {
      notePlayerMounted();
      notePlayerReleased();
    }
    assert.equal(playbackPlayerCount(), 0);
  });
});
