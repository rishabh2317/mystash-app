import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  COLLECTION_INLINE_PLAYER_MAX_WIDTH,
  COLLECTION_PAGE_EMBEDS_PLAYER,
  ORIGINAL_REEL_LABEL,
  buildCollectionPreviewVideo,
  collectionInlinePlayerWidth,
  collectionMediaReference,
  collectionMediaSourceUrl,
  collectionMediaWatchLinkLabel,
  collectionReelPath,
  collectionTilePressPath,
  collectionReelPlayerSize,
  originalReelPlatformLabel,
  splitCollectionProducts,
} from './collectionLayout';

function product(id: string): CatalogProductViewModel {
  return {
    id,
    catalogProductId: id,
    title: id,
    brand: null,
    merchant: null,
    heroImage: null,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNVERIFIED',
    availability: null,
    price: null,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  };
}

function collection(
  partial: Partial<CollectionDetailViewModel> = {},
): CollectionDetailViewModel {
  return {
    collectionId: 'col-1',
    slug: 'slug',
    title: 'Summer',
    caption: 'Picks',
    heroThumbnailUrl: 'https://example.com/hero.jpg',
    qualityScore: 4,
    publishedAt: null,
    creator: {
      id: 'creator-1',
      username: 'alex',
      displayName: 'Alex',
      avatarUrl: null,
    },
    counters: { views: 0, saves: 0 },
    primaryMedia: {
      platform: 'youtube',
      sourceUrl: 'https://youtube.com/shorts/abc12345678',
      embedUrl: 'https://www.youtube.com/embed/abc12345678',
      thumbnailUrl: 'https://example.com/poster.jpg',
      title: 'Short',
    },
    products: [],
    ...partial,
  };
}

describe('UX-B.5 collection layout', () => {
  it('embeds a compact inline player on the Collection page', () => {
    assert.equal(COLLECTION_PAGE_EMBEDS_PLAYER, true);
  });

  it('opens the existing Focused Reel route for full-screen', () => {
    assert.equal(collectionReelPath('col-1'), '/reel/col-1');
    assert.equal(collectionTilePressPath('col-1'), '/reel/col-1');
  });

  it('keeps products first: featured rail only when there are 4+ items, shop-all is the full list', () => {
    const three = splitCollectionProducts([product('a'), product('b'), product('c')]);
    assert.deepEqual(three.featured.map((p) => p.id), []);
    assert.equal(three.shopAll.length, 3);

    const five = splitCollectionProducts([
      product('a'),
      product('b'),
      product('c'),
      product('d'),
      product('e'),
    ]);
    assert.deepEqual(five.featured.map((p) => p.id), ['a', 'b', 'c']);
    assert.deepEqual(five.shopAll.map((p) => p.id), ['a', 'b', 'c', 'd', 'e']);
  });

  it('builds media reference + preview video for inline embed', () => {
    const ref = collectionMediaReference(collection());
    assert.ok(ref);
    assert.equal(ref.label, ORIGINAL_REEL_LABEL);
    assert.equal(ref.posterUrl, 'https://example.com/poster.jpg');
    assert.equal(ref.embedUrl, 'https://www.youtube.com/embed/abc12345678');
    assert.equal(ref.reelPath, '/reel/col-1');
    assert.equal(originalReelPlatformLabel('youtube'), 'YouTube Short');
    assert.equal(originalReelPlatformLabel('instagram'), 'Instagram Reel');

    const video = buildCollectionPreviewVideo(collection());
    assert.ok(video);
    assert.equal(video.collection_id, 'col-1');
    assert.equal(video.embed_url, 'https://www.youtube.com/embed/abc12345678');
  });

  it('sizes the compact reel player within editorial bounds', () => {
    assert.equal(collectionInlinePlayerWidth(390), 226);
    assert.equal(collectionInlinePlayerWidth(320), 200);
    assert.ok(collectionInlinePlayerWidth(500) <= COLLECTION_INLINE_PLAYER_MAX_WIDTH);
    assert.deepEqual(collectionReelPlayerSize(390), { width: 226, height: 402 });
  });

  it('exposes the public source URL for the media link', () => {
    const ref = collectionMediaReference(collection());
    assert.ok(ref);
    assert.equal(
      collectionMediaSourceUrl(ref),
      'https://youtube.com/shorts/abc12345678',
    );
    assert.equal(collectionMediaWatchLinkLabel('youtube'), 'Watch on YT');
    assert.equal(collectionMediaWatchLinkLabel('instagram'), 'Watch on Instagram');
    assert.equal(collectionMediaWatchLinkLabel('unknown'), null);
  });

  it('hides media reference when there is no poster or source', () => {
    const ref = collectionMediaReference(
      collection({
        heroThumbnailUrl: null,
        primaryMedia: {
          platform: 'unknown',
          sourceUrl: null,
          embedUrl: null,
          thumbnailUrl: null,
          title: null,
        },
      }),
    );
    assert.equal(ref, null);
  });
});
