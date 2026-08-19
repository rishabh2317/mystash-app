import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapCollectionDetailToReelViewModel,
  mapReelViewModelToVideo,
} from './reelMapper';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';

const detail: CollectionDetailViewModel = {
  collectionId: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'test-collection',
  title: 'Beach Essentials',
  caption: 'Summer picks',
  heroThumbnailUrl: 'https://example.com/hero.jpg',
  qualityScore: 4.6,
  publishedAt: '2026-08-01T00:00:00.000Z',
  creator: {
    id: '11111111-1111-1111-1111-111111111111',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
  },
  counters: { views: 10, saves: 2 },
  primaryMedia: {
    platform: 'youtube',
    sourceUrl: 'https://youtube.com/watch?v=abc',
    embedUrl: 'https://www.youtube.com/embed/abc',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    title: 'Beach haul',
  },
  products: [
    {
      id: 'tag-1',
      catalogProductId: 'cat-1',
      title: 'Towel',
      brand: null,
      merchant: 'Shop',
      heroImage: 'https://example.com/towel.jpg',
      galleryImages: [],
      description: null,
      shortDescription: null,
      specifications: {},
      verificationStatus: 'UNVERIFIED',
      availability: null,
      price: '$20',
      currency: 'USD',
      lastVerifiedAt: null,
      metadataCompleteness: null,
    },
  ],
};

describe('reelMapper', () => {
  it('maps Collection detail to ReelViewModel with same collectionId', () => {
    const reel = mapCollectionDetailToReelViewModel(detail);
    assert.equal(reel.collectionId, detail.collectionId);
    assert.equal(reel.title, 'Beach Essentials');
    assert.equal(reel.primaryMedia.platform, 'youtube');
    assert.equal(reel.products.length, 1);
    assert.equal(reel.products[0]!.catalogProductId, 'cat-1');
  });

  it('adapts ReelViewModel to Video without using video.id as Collection id', () => {
    const reel = mapCollectionDetailToReelViewModel(detail);
    const video = mapReelViewModelToVideo(reel);

    assert.equal(video.collection_id, detail.collectionId);
    assert.notEqual(video.id, detail.collectionId);
    assert.equal(video.products?.[0]?.name, 'Towel');
    assert.equal(video.embed_url, 'https://www.youtube.com/embed/abc');
  });
});
