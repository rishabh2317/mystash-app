import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  COLLECTION_MEDIA_MAX_HEIGHT_RATIO,
  COLLECTION_PAGE_EMBEDS_PLAYER,
  COLLECTION_SCROLL_HORIZONTAL_PADDING,
  ORIGINAL_REEL_LABEL,
  buildCollectionPreviewVideo,
  collectionMediaFrameSize,
  collectionMediaReference,
  collectionMediaSourceUrl,
  collectionMediaWatchLinkLabel,
  collectionReelPath,
  collectionTilePressPath,
  originalReelPlatformLabel,
  COLLECTION_YOUTUBE_CROP_SCALE,
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
    assert.ok(COLLECTION_YOUTUBE_CROP_SCALE > 1.12);
  });

  it('opens the existing Focused Reel route for full-screen', () => {
    assert.equal(collectionReelPath('col-1'), '/reel/col-1');
    assert.equal(collectionTilePressPath('col-1'), '/reel/col-1');
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

  it('keeps the editorial media frame portrait and inside the viewport', () => {
    const contentWidth = 390 - COLLECTION_SCROLL_HORIZONTAL_PADDING * 2;
    const phone = collectionMediaFrameSize({ screenWidth: 390, screenHeight: 844 });
    assert.equal(phone.width, 313);
    assert.equal(phone.height, 556);
    assert.ok(phone.height / phone.width > 1.7, 'stays portrait');
    assert.ok(phone.width <= contentWidth);
    // The evidence should dominate: near the full content column, not a narrow
    // frame floating inside it.
    assert.ok(phone.width / contentWidth > 0.85, 'fills most of the content column');

    // Short/wide viewport: height budget wins, never a landscape crop.
    const short = collectionMediaFrameSize({ screenWidth: 430, screenHeight: 600 });
    assert.ok(short.height <= 600 * COLLECTION_MEDIA_MAX_HEIGHT_RATIO + 1);
    assert.ok(short.height > short.width);

    // Narrow viewport: never wider than the content column.
    const narrow = collectionMediaFrameSize({ screenWidth: 320, screenHeight: 1000 });
    assert.equal(narrow.width, 320 - COLLECTION_SCROLL_HORIZONTAL_PADDING * 2);
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
