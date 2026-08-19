import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSupportedVideoUrl,
  extractInstagramPostId,
  extractYouTubeVideoId,
} from './sourceIdentity';

describe('parseSupportedVideoUrl', () => {
  it('canonicalizes YouTube Shorts and watch URLs to the same video id', () => {
    const shorts = parseSupportedVideoUrl('https://www.youtube.com/shorts/abcdefghijk?si=abc');
    const watch = parseSupportedVideoUrl('https://youtu.be/abcdefghijk');
    assert.ok(shorts);
    assert.ok(watch);
    assert.equal(shorts.externalId, 'abcdefghijk');
    assert.equal(watch.canonicalUrl, shorts.canonicalUrl);
    assert.equal(shorts.canonicalUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  });

  it('canonicalizes Instagram reel/reels/p variants', () => {
    const reel = parseSupportedVideoUrl('https://www.instagram.com/reel/AbC123xyz/?igsh=1');
    const reels = parseSupportedVideoUrl('https://www.instagram.com/reels/AbC123xyz/');
    const post = parseSupportedVideoUrl('https://www.instagram.com/p/AbC123xyz/');
    assert.ok(reel && reels && post);
    assert.equal(reel.externalId, 'AbC123xyz');
    assert.equal(reel.canonicalUrl, reels.canonicalUrl);
    assert.equal(post.canonicalUrl, 'https://www.instagram.com/reel/AbC123xyz/');
  });

  it('rejects Instagram profile URLs and unknown hosts', () => {
    assert.equal(parseSupportedVideoUrl('https://www.instagram.com/nike/'), null);
    assert.equal(parseSupportedVideoUrl('https://tiktok.com/@x/video/1'), null);
    assert.equal(parseSupportedVideoUrl('not-a-url'), null);
  });

  it('extracts ids', () => {
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
    assert.equal(extractInstagramPostId('https://instagram.com/reel/Zz_11/'), 'Zz_11');
  });
});
