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

  it('CollectionScreen opens Product Page and uses PublicCollectionTile for creator posts', () => {
    const src = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    assert.doesNotMatch(src, /ProductAiReviewCard/);
    assert.doesNotMatch(src, /AiReviewSheet/);
    assert.doesNotMatch(src, /ProductDetailsSheet/);
    assert.doesNotMatch(src, /onAiReview/);
    assert.match(src, /productPagePath/);
    assert.match(src, /fetchProductPage/);
    assert.match(src, /openProductShopping/);
    assert.match(src, /loadCollectionRelatedProducts/);
    assert.match(src, /listCreatorCollections/);
    assert.match(src, /COLLECTION_PRODUCT_COPY\.relatedProducts/);
    assert.match(src, /COLLECTION_PRODUCT_COPY\.moreFromCreator/);
    assert.match(src, /collectionTilePressPath/);
    assert.match(src, /variant="collection"/);
    assert.match(src, /variant="related"/);
    assert.match(src, /PublicCollectionTile/);
    assert.doesNotMatch(src, /variant="creatorRail"/);
    assert.match(src, /softCanvasGradient/);
  });

  it('collection ProductCard shows buying-option rows + corner icon Stash', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("variant === 'collection'");
    const end = src.indexOf("variant === 'publicProfile'", start);
    const collection = src.slice(start, end === -1 ? undefined : end);
    assert.match(collection, /outlineCardChrome\(tokens\)/);
    assert.match(collection, /typeStyle\(tokens, 'tileTitle'\)/);
    assert.match(collection, /COLLECTION_MERCHANT_PREVIEW_LIMIT/);
    assert.match(collection, /viewMoreMerchants/);
    assert.match(collection, /offerMerchant/);
    assert.match(collection, /offerPrice/);
    assert.match(collection, /priceLabel/);
    assert.match(collection, /variant="icon"/);
    assert.match(collection, /collectionStash/);
    assert.doesNotMatch(collection, /viewProductDetails/);
    assert.doesNotMatch(collection, /variant="quiet"/);
    assert.doesNotMatch(collection, /tilePrice/);
    assert.doesNotMatch(collection, /TrustStrip/);
    assert.doesNotMatch(collection, /VerificationBadge/);
  });

  it('Collection media has no play\/mute overlay chrome', () => {
    const media = readFileSync(
      join(ROOT, 'components/collection/CollectionMediaReference.tsx'),
      'utf8',
    );
    assert.doesNotMatch(media, /Pause reel/);
    assert.doesNotMatch(media, /Play reel/);
    assert.doesNotMatch(media, /togglePlayback/);
    assert.doesNotMatch(media, /toggleMute/);
    assert.doesNotMatch(media, /chromeFooter/);
  });

  it('related cards clamp the title to one line', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("variant === 'related'");
    const end = src.indexOf('\n  return (', start);
    const related = src.slice(start, end === -1 ? undefined : end);
    assert.match(related, /numberOfLines=\{1\}/);
    assert.doesNotMatch(related, /numberOfLines=\{2\}/);
  });

  it('collection ProductCard uses shared typeStyle and two-line titles', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("variant === 'collection'");
    const end = src.indexOf("variant === 'publicProfile'", start);
    const collection = src.slice(start, end === -1 ? undefined : end);
    assert.match(collection, /outlineCardChrome\(tokens\)/);
    assert.match(collection, /typeStyle\(tokens, 'tileTitle'\)/);
    assert.match(collection, /numberOfLines=\{2\}/);
    assert.doesNotMatch(collection, /TrustStrip/);
    assert.doesNotMatch(collection, /VerificationBadge/);
    assert.doesNotMatch(collection, /extraBold/);
  });

  it('related ProductCard uses shared transparent outline chrome', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("variant === 'related'");
    const end = src.indexOf('\n  return (', start);
    const related = src.slice(start, end === -1 ? undefined : end);
    assert.match(related, /outlineCardChrome\(tokens\)/);
    assert.doesNotMatch(related, /backgroundColor:\s*tokens\.color\.surface(?!\w)/);
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

  it('publicProfile ProductCard stays media-first immersive', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("if (variant === 'publicProfile')");
    const end = src.indexOf("if (variant === 'mini')", start);
    const publicProfile = src.slice(start, end === -1 ? undefined : end);
    assert.match(publicProfile, /IMMERSIVE_TOKENS\.stage/);
    assert.doesNotMatch(publicProfile, /outlineCardChrome/);
  });

  it('mini ProductCard is a compact related-style carousel tile without price', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');
    const start = src.indexOf("if (variant === 'mini')");
    const end = src.indexOf("if (variant === 'related')", start);
    const mini = src.slice(start, end === -1 ? undefined : end);
    assert.match(mini, /outlineCardChrome\(tokens\)/);
    assert.match(mini, /typeStyle\(tokens, 'tileTitle'\)/);
    assert.match(mini, /numberOfLines=\{1\}/);
    assert.match(mini, /variant="icon"/);
    assert.doesNotMatch(mini, /tileMeta/);
    assert.doesNotMatch(mini, /priceLabel/);
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
  });

  it('Add to Bag stays pressable after a successful add so it can remove', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/AddToCartButton.tsx'), 'utf8');
    assert.doesNotMatch(src, /if \(pending \|\| added\) return/);
    assert.doesNotMatch(src, /disabled=\{pending \|\| added\}/);
    assert.match(src, /outcome === 'removed'/);
  });

  it('shows a red outline trash icon when the product is already in Stash', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/AddToCartButton.tsx'), 'utf8');
    assert.match(src, /trash-outline/);
    assert.match(src, /bag-add-outline/);
    assert.match(src, /tokens\.immersive\.icon/);
    assert.match(src, /tokens\.immersive\.controlStrong/);
    assert.match(src, /Remove \$\{product\.title\} from your Stash\?/);
    assert.match(src, /Alert\.alert\(BAG_COPY\.removeFromBag/);
    assert.doesNotMatch(src, /bag-check/);
    assert.doesNotMatch(src, /#FF3B30/);
  });

  it('never renders the AI Review API message for the unavailable state', () => {
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

  it('keeps Collection hero on shared typeStyle, not display sizes', () => {
    const hero = readFileSync(join(ROOT, 'components/collection/CollectionHero.tsx'), 'utf8');
    const credit = readFileSync(join(ROOT, 'components/collection/CollectionCuratorCredit.tsx'), 'utf8');
    const header = readFileSync(join(ROOT, 'components/collection/CollectionPageHeader.tsx'), 'utf8');
    const screen = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    const feed = readFileSync(join(ROOT, 'components/feed/FeedCreatorBlock.tsx'), 'utf8');
    assert.match(hero, /typeStyle\(tokens, 'identityTitle'\)/);
    assert.doesNotMatch(hero, /FollowControl/);
    assert.doesNotMatch(hero, /fontSize: tokens\.fontSize\.display/);
    assert.match(credit, /COLLECTION_SECTION_COPY\.curatedBy/);
    assert.match(credit, /FollowControl/);
    assert.match(credit, /size="micro"/);
    assert.match(credit, /creditRow/);
    assert.doesNotMatch(credit, /size="compact"/);
    assert.match(credit, /lineHeight\.caption/);
    assert.match(credit, /lineHeight\.body/);
    assert.doesNotMatch(credit, /lineHeight\.micro/);
    assert.doesNotMatch(credit, /displayName/);
    assert.match(header, /share=\{/);
    assert.match(header, /title = 'Shop'/);
    assert.doesNotMatch(header, /OverflowMenu/);
    assert.match(screen, /CollectionCuratorCredit/);
    assert.match(screen, /title="Shop"/);
    assert.match(screen, /useBottomTabBarHeight/);
    assert.doesNotMatch(screen, /overflowItems/);
    assert.doesNotMatch(screen, /View Bag/);
    assert.match(feed, /fontSize: tokens\.fontSize\.caption/);
    assert.match(feed, /fontFamily: tokens\.fontFamily\.medium/);
    assert.match(feed, /view more/);
    assert.match(feed, /numberOfLines=\{1\}/);
    assert.match(feed, /ContentPlayChip/);
    assert.match(feed, /moreFromCreator \?/);
  });
});
