import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { COLLECTION_PRODUCT_COPY } from '@/src/ui/collectionProductActions';

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
    assert.match(sheet, /not available for this product yet/);
    assert.doesNotMatch(api, /pros\.push|cons\.push/);
    assert.equal(COLLECTION_PRODUCT_COPY.aiReview, 'AI Review');
  });
});
