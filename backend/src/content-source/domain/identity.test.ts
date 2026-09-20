import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCacheKey } from '../../config/pipelineConfig';
import { normalizeSharedInput } from '../../user-import/domain/sharedInput';
import { resolveContentSourceIdentity, videoExtractionCacheLookup } from './identity';
import {
  CONTENT_PROCESSING_STATUSES,
  canTransitionContentProcessingStatus,
  isContentProcessingStatus,
  shouldEnqueueProcessing,
  shouldClaimForProcessing,
} from './lifecycle';

/** Phase 2 always resolves identity from the validated normalized URL. */
function identityForShare(rawInput: string) {
  const normalized = normalizeSharedInput(rawInput);
  assert.equal(normalized.ok, true, `expected accept for ${rawInput}`);
  if (!normalized.ok) throw new Error('unreachable');
  return resolveContentSourceIdentity(normalized.value.normalizedUrl);
}

describe('content source identity', () => {
  it('resolves equivalent YouTube URLs to one (platform, external_id)', () => {
    const shorts = identityForShare('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    const short = identityForShare('https://youtu.be/dQw4w9WgXcQ?si=abc');
    const watch = identityForShare('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s');
    const inText = identityForShare('look → https://youtu.be/dQw4w9WgXcQ');

    for (const identity of [shorts, short, watch, inText]) {
      assert.equal(identity.platform, 'youtube');
      assert.equal(identity.externalId, 'dQw4w9WgXcQ');
      assert.equal(identity.mediaKind, 'VIDEO');
      assert.equal(identity.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  });

  it('resolves equivalent Instagram reel URLs to one identity', () => {
    const reel = identityForShare('https://www.instagram.com/reel/ABC123/');
    const reels = identityForShare('https://instagram.com/reels/ABC123/?igshid=xyz');
    const post = identityForShare('https://www.instagram.com/p/ABC123/');

    for (const identity of [reel, reels, post]) {
      assert.equal(identity.platform, 'instagram');
      assert.equal(identity.externalId, 'ABC123');
      assert.equal(identity.mediaKind, 'VIDEO');
    }
  });

  it('separates different videos on the same platform', () => {
    const a = identityForShare('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    const b = identityForShare('https://www.youtube.com/shorts/aaaaaaaaaaa');
    assert.notEqual(a.externalId, b.externalId);
  });

  it('uses canonical-URL identity for product / web pages', () => {
    const plain = identityForShare('https://shop.example.com/p/mug');
    const tracked = identityForShare(
      'Loved this: https://shop.example.com/p/mug?utm_source=ig&fbclid=xyz#reviews',
    );

    assert.equal(plain.platform, 'web');
    assert.equal(plain.mediaKind, 'WEB_PAGE');
    assert.equal(plain.canonicalUrl, 'https://shop.example.com/p/mug');
    assert.equal(tracked.externalId, plain.externalId);
    assert.match(plain.externalId, /^m_[0-9a-f]{28}$/);
  });

  it('keeps meaningful query parameters distinct for web pages', () => {
    const large = identityForShare('https://shop.example.com/p/mug?size=large');
    const small = identityForShare('https://shop.example.com/p/mug?size=small');
    assert.notEqual(large.externalId, small.externalId);
  });

  it('feeds the existing video extraction cache key without a second normalizer', () => {
    const shorts = identityForShare('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    const short = identityForShare('https://youtu.be/dQw4w9WgXcQ?si=abc');
    const page = identityForShare('https://shop.example.com/p/mug');

    const lookupA = videoExtractionCacheLookup(shorts);
    const lookupB = videoExtractionCacheLookup(short);
    assert.deepEqual(lookupA, { platform: 'youtube', externalVideoId: 'dQw4w9WgXcQ' });
    assert.deepEqual(lookupA, lookupB);
    assert.equal(videoExtractionCacheLookup(page), null);

    const keyA = buildCacheKey(lookupA!);
    const keyB = buildCacheKey(lookupB!);
    assert.equal(keyA, keyB);
    assert.match(keyA, /^youtube:dQw4w9WgXcQ:/);
  });
});

describe('content source processing lifecycle', () => {
  it('enqueues only from RECEIVED or FAILED', () => {
    assert.equal(shouldEnqueueProcessing('RECEIVED'), true);
    assert.equal(shouldEnqueueProcessing('FAILED'), true);
    assert.equal(shouldClaimForProcessing('QUEUED'), true);
    assert.equal(shouldClaimForProcessing('PROCESSING'), true);
    assert.equal(shouldClaimForProcessing('READY'), false);
    assert.equal(shouldClaimForProcessing('FAILED'), false);
  });

  it('allows only the transitions the ingest lifecycle already supports', () => {
    assert.equal(canTransitionContentProcessingStatus('RECEIVED', 'QUEUED'), true);
    assert.equal(canTransitionContentProcessingStatus('QUEUED', 'PROCESSING'), true);
    assert.equal(canTransitionContentProcessingStatus('PROCESSING', 'READY'), true);
    assert.equal(canTransitionContentProcessingStatus('PROCESSING', 'FAILED'), true);
    assert.equal(canTransitionContentProcessingStatus('FAILED', 'QUEUED'), true);

    assert.equal(canTransitionContentProcessingStatus('RECEIVED', 'READY'), false);
    assert.equal(canTransitionContentProcessingStatus('RECEIVED', 'PROCESSING'), false);
    assert.equal(canTransitionContentProcessingStatus('QUEUED', 'READY'), false);
    assert.equal(canTransitionContentProcessingStatus('QUEUED', 'QUEUED'), false);
  });

  it('declares no product-resolution states', () => {
    assert.deepEqual(
      [...CONTENT_PROCESSING_STATUSES],
      ['RECEIVED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'],
    );
    assert.equal(isContentProcessingStatus('VERIFIED'), false);
    assert.equal(isContentProcessingStatus('UNRESOLVED'), false);
    assert.equal(isContentProcessingStatus('QUEUED'), true);
  });
});
