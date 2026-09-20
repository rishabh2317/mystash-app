import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { COLLECTION_PRODUCT_COPY } from '@/src/ui/collectionProductActions';
import { COLLECTION_SECTION_COPY } from '@/src/ui/collectionSections';

const ROOT = join(import.meta.dirname, '..', '..');

describe('collection product card actions', () => {
  it('ProductCard supports AI Review and merchant shortcut props', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    assert.match(src, /onAiReview\?:/);
    assert.match(src, /onMerchantShortcut\?:/);
    assert.match(src, /COLLECTION_PRODUCT_COPY\.aiReview/);
    assert.match(src, /open-outline/);
    assert.match(src, /showBuy = .*!showAiReview/);
  });

  it('CollectionScreen wires AI Review, merchant shortcut, related products, and creator more', () => {
    const src = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    assert.match(src, /AiReviewSheet/);
    assert.match(src, /onAiReview/);
    assert.match(src, /onMerchantShortcut/);
    assert.match(src, /openProductShopping/);
    assert.match(src, /loadCollectionRelatedProducts/);
    assert.match(src, /listCreatorCollections/);
    assert.match(src, /COLLECTION_PRODUCT_COPY\.relatedProducts/);
    assert.match(src, /COLLECTION_PRODUCT_COPY\.moreFromCreator/);
    assert.match(src, /collectionTilePressPath/);
    assert.doesNotMatch(src, /onBuy=\{product\.catalogProductId \? onBuy/);
  });

  it('AiReviewSheet fetches summaries without inventing content client-side', () => {
    const sheet = readFileSync(join(ROOT, 'components/commerce/AiReviewSheet.tsx'), 'utf8');
    const api = readFileSync(join(ROOT, 'src/services/productAiReviewApi.ts'), 'utf8');
    assert.match(sheet, /fetchProductAiReview/);
    assert.match(sheet, /COLLECTION_SECTION_COPY\.aiReviewUnavailable/);
    assert.match(COLLECTION_SECTION_COPY.aiReviewUnavailable, /not available for this product yet/);
    assert.doesNotMatch(api, /pros\.push|cons\.push/);
    assert.equal(COLLECTION_PRODUCT_COPY.aiReview, 'AI Review');
  });

  it('related cards clamp the title to one line', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("variant === 'related'");
    const end = src.indexOf('\n  return (', start);
    const related = src.slice(start, end === -1 ? undefined : end);
    assert.match(related, /numberOfLines=\{1\}/);
    assert.doesNotMatch(related, /numberOfLines=\{2\}/);
  });

  it('Collection YouTube embed loops and can play/pause without Home changing', () => {
    const yt = readFileSync(join(ROOT, 'src/utils/youtubeWebViewEmbed.ts'), 'utf8');
    const media = readFileSync(
      join(ROOT, 'components/collection/CollectionMediaReference.tsx'),
      'utf8',
    );
    assert.match(yt, /__mystashSetPlaying/);
    assert.match(yt, /options\.loop/);
    assert.match(media, /loop: true/);
    assert.match(media, /COLLECTION_YOUTUBE_CROP_SCALE/);
    assert.match(media, /crop: 'collection'/);
    assert.match(media, /playing \? 'pause' : 'play'/);
  });

  it('Add to Bag stays pressable after a successful add so it can remove', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/AddToCartButton.tsx'), 'utf8');
    assert.doesNotMatch(src, /if \(pending \|\| added\) return/);
    assert.doesNotMatch(src, /disabled=\{pending \|\| added\}/);
    assert.match(src, /outcome === 'removed'/);
  });

  it('never renders the AI Review API message for the unavailable state', () => {
    // The API can return a raw provider error ("Gemini request failed"), which
    // is diagnostics rather than user-facing copy.
    for (const file of [
      'components/commerce/AiReviewSheet.tsx',
      'components/commerce/ProductAiReviewCard.tsx',
    ]) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      assert.doesNotMatch(
        src,
        /status === 'unavailable'\s*\n?\s*\?\s*result\.message/,
        `${file} must not surface the unavailable message`,
      );
    }
  });

  it('keeps Collection and Home titles on shared type steps, not screen-specific sizes', () => {
    const hero = readFileSync(join(ROOT, 'components/collection/CollectionHero.tsx'), 'utf8');
    const feed = readFileSync(join(ROOT, 'components/feed/FeedCreatorBlock.tsx'), 'utf8');
    assert.match(hero, /fontSize: tokens\.fontSize\.section/);
    assert.doesNotMatch(hero, /fontSize: tokens\.fontSize\.display/);
    assert.match(feed, /fontSize: tokens\.fontSize\.caption/);
    assert.match(feed, /numberOfLines=\{2\}/);
    assert.match(feed, /ContentPlayChip/);
    assert.match(feed, /moreFromCreator \?/);
  });
});
