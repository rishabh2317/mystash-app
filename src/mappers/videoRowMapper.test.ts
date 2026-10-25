import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapVideoRow } from './videoRowMapper';

describe('videoRowMapper / fetchVideos projection', () => {
  it('exposes collection_id on the Video projection', () => {
    const collectionId = '550e8400-e29b-41d4-a716-446655440000';
    const videoId = '660e8400-e29b-41d4-a716-446655440001';

    const mapped = mapVideoRow(
      {
        id: videoId,
        url: 'https://youtube.com/watch?v=abc',
        thumbnail: 'https://example.com/thumb.jpg',
        creator_name: 'curator',
        stash_score: 4.5,
        product_name: 'Sample',
        collection_id: collectionId,
      },
      [],
    );

    assert.equal(mapped.collection_id, collectionId);
    assert.equal(mapped.id, videoId);
    assert.notEqual(mapped.id, mapped.collection_id);
  });

  it('maps missing collection_id to null without falling back to video id', () => {
    const videoId = '660e8400-e29b-41d4-a716-446655440001';

    const mapped = mapVideoRow(
      {
        id: videoId,
        url: 'https://youtube.com/watch?v=abc',
        thumbnail: 'https://example.com/thumb.jpg',
        creator_name: 'curator',
        stash_score: 4.5,
        product_name: 'Sample',
      },
      [],
    );

    assert.equal(mapped.collection_id, null);
    assert.notEqual(mapped.collection_id, videoId);
  });

  it('paints the reel from the video row when product rows are still absent', () => {
    const mapped = mapVideoRow(
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
        creator_name: 'ada',
        stash_score: 4.5,
        product_name: 'Lamp',
        embed_url: 'https://www.youtube.com/embed/abcdefghijk',
        video_title: 'Desk tour',
        collection_id: '550e8400-e29b-41d4-a716-446655440000',
      },
      [],
    );
    assert.equal(mapped.thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    assert.equal(mapped.product_name, 'Lamp');
    assert.equal(mapped.products, undefined);
  });
});
