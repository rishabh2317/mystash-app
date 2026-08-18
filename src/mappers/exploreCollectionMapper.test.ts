import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Video } from '@/src/mocks/videos';
import { videoToExploreCollection, videosToExploreCollections } from './exploreCollectionMapper';

function video(partial: Partial<Video> & Pick<Video, 'id'>): Video {
  return {
    url: 'https://youtube.com/shorts/x',
    thumbnail: 'https://img.example/t.jpg',
    creator_name: 'Ada',
    stash_score: 4,
    product_name: 'Shoes',
    ...partial,
  };
}

describe('exploreCollectionMapper', () => {
  it('maps published Home videos with collection_id onto collection tiles', () => {
    const mapped = videoToExploreCollection(
      video({
        id: 'v1',
        collection_id: 'col-1',
        video_title: 'Summer reel',
        curator_id: 'user-1',
        products: [{ id: 'p1', name: 'Hat', price: '10', image: '' }],
      }),
    );
    assert.ok(mapped);
    assert.equal(mapped.collectionId, 'col-1');
    assert.equal(mapped.title, 'Summer reel');
    assert.equal(mapped.productCount, 1);
    assert.equal(mapped.creator.displayName, 'Ada');
  });

  it('skips videos without a collection identity', () => {
    assert.equal(videoToExploreCollection(video({ id: 'v1', collection_id: null })), null);
    assert.equal(videoToExploreCollection(video({ id: 'v2', collection_id: '  ' })), null);
  });

  it('dedupes by collectionId and keeps newest-first Home order', () => {
    const out = videosToExploreCollections([
      video({ id: 'v-new', collection_id: 'col-a', video_title: 'New' }),
      video({ id: 'v-old-dup', collection_id: 'col-a', video_title: 'Old dup' }),
      video({ id: 'v-b', collection_id: 'col-b', video_title: 'B' }),
      video({ id: 'legacy', collection_id: null }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.collectionId, 'col-a');
    assert.equal(out[0]!.title, 'New');
    assert.equal(out[1]!.collectionId, 'col-b');
  });
});
