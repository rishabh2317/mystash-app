import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertIndependentVideoAndCollectionIds,
  buildVideoProductInserts,
  resolvePublishVideoId,
} from './publishVideoProjection';

describe('publishVideoProjection', () => {
  const collectionId = '550e8400-e29b-41d4-a716-446655440000';
  const newVideoId = '660e8400-e29b-41d4-a716-446655440001';
  const existingVideoId = '770e8400-e29b-41d4-a716-446655440002';

  it('assigns independent Video and Collection IDs on first publish', () => {
    const resolved = resolvePublishVideoId({
      existingVideoId: null,
      newVideoId,
    });

    assert.equal(resolved.shouldInsertVideo, true);
    assert.equal(resolved.videoId, newVideoId);
    assert.notEqual(resolved.videoId, collectionId);
    assert.doesNotThrow(() =>
      assertIndependentVideoAndCollectionIds(resolved.videoId, collectionId),
    );
  });

  it('stores collection_id separately from Video.id in dual-write payload', () => {
    const resolved = resolvePublishVideoId({
      existingVideoId: null,
      newVideoId,
    });

    const insertPayload = {
      id: resolved.videoId,
      collection_id: collectionId,
    };

    assert.notEqual(insertPayload.id, insertPayload.collection_id);
    assert.equal(insertPayload.collection_id, collectionId);
  });

  it('reuses the existing Video.id on re-publish', () => {
    const resolved = resolvePublishVideoId({
      existingVideoId,
      newVideoId,
    });

    assert.equal(resolved.shouldInsertVideo, false);
    assert.equal(resolved.videoId, existingVideoId);
    assert.notEqual(resolved.videoId, newVideoId);
  });

  it('does not create a duplicate Video row on re-publish', () => {
    const first = resolvePublishVideoId({ existingVideoId: null, newVideoId });
    const second = resolvePublishVideoId({ existingVideoId, newVideoId });

    assert.equal(first.shouldInsertVideo, true);
    assert.equal(second.shouldInsertVideo, false);
    assert.equal(second.videoId, existingVideoId);
  });

  it('binds video_products rows to the resolved Video.id', () => {
    const resolved = resolvePublishVideoId({
      existingVideoId,
      newVideoId,
    });

    const rows = buildVideoProductInserts(resolved.videoId, [
      {
        name: 'Product A',
        price: '10',
        image: 'https://example.com/a.jpg',
        merchant_url: 'https://shop.example/a',
        affiliate_url: null,
        provider: 'catalog',
        sort_order: 0,
        catalog_product_id: '880e8400-e29b-41d4-a716-446655440003',
        resolution_status: 'UNRESOLVED',
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.video_id, existingVideoId);
    assert.notEqual(rows[0]!.video_id, newVideoId);
  });

  it('rejects video id equal to collection id', () => {
    assert.throws(
      () => assertIndependentVideoAndCollectionIds(collectionId, collectionId),
      /must not equal collection id/,
    );
  });
});
