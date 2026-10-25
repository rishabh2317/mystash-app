import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickPlaceListImage } from './placeListImage';

describe('pickPlaceListImage', () => {
  it('prefers a real provider image, then source thumbnail, then a video frame', () => {
    assert.deepEqual(
      pickPlaceListImage({
        allowProvider: true,
        providerImageUrl: 'https://places.example/photo.jpg',
        sourceThumbnailUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
        frameUrl: 'https://cdn.example/frame.jpg',
      }),
      { url: 'https://places.example/photo.jpg', kind: 'provider' },
    );
    assert.deepEqual(
      pickPlaceListImage({
        allowProvider: true,
        providerImageUrl: null,
        sourceThumbnailUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
        frameUrl: 'https://cdn.example/frame.jpg',
      }),
      { url: 'https://img.youtube.com/vi/abc/hqdefault.jpg', kind: 'source' },
    );
    assert.deepEqual(
      pickPlaceListImage({
        allowProvider: true,
        sourceThumbnailUrl: null,
        frameUrl: 'https://cdn.example/frame.jpg',
      }),
      { url: 'https://cdn.example/frame.jpg', kind: 'frame' },
    );
  });

  it('never uses a provider image for unresolved leads', () => {
    assert.deepEqual(
      pickPlaceListImage({
        allowProvider: false,
        providerImageUrl: 'https://places.example/photo.jpg',
        sourceThumbnailUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
      }),
      { url: 'https://img.youtube.com/vi/abc/hqdefault.jpg', kind: 'source' },
    );
    assert.equal(
      pickPlaceListImage({
        allowProvider: false,
        providerImageUrl: 'https://places.example/photo.jpg',
      }),
      null,
    );
  });

  it('does not invent a url when nothing real is present', () => {
    assert.equal(pickPlaceListImage({ allowProvider: true, providerImageUrl: 'not-a-url' }), null);
    assert.equal(pickPlaceListImage({ allowProvider: true }), null);
  });
});
