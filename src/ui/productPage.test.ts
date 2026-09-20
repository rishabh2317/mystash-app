import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { hydrateProductPage } from '@/src/services/productPageMap';
import {
  PRODUCT_PAGE_COPY,
  productAiReviewFromPage,
  productPageOfferCta,
  productPagePath,
  productPageRatingLabel,
  productPageSections,
  relatedMediaPath,
} from '@/src/ui/productPage';

const ROOT = process.cwd();
const FORBIDDEN = /discovered product|unverified|confidence|completeness|catalogue status|catalog status|ai status|verification/i;

describe('product page presentation', () => {
  it('builds a Bag → Product Page path with source attribution', () => {
    assert.equal(
      productPagePath('abc-1', {
        contentSourceId: 'cs-1',
        userImportId: 'imp-1',
      }),
      '/product/abc-1?contentSourceId=cs-1&userImportId=imp-1',
    );
    assert.equal(productPagePath('abc-1'), '/product/abc-1');
  });

  it('hides empty sections and keeps Compare available', () => {
    const page = hydrateProductPage({
      productId: 'p1',
      shoppingProductId: null,
      title: 'Mug',
      brand: null,
      category: null,
      heroImage: null,
      galleryImages: [],
      price: null,
      currency: null,
      merchant: null,
      description: null,
      specifications: {},
      offers: [],
      canShop: false,
      source: null,
      relatedMedia: [],
      compareAvailable: true,
    });
    assert.ok(page);
    const sections = productPageSections(page!);
    assert.equal(sections.offers, false);
    assert.equal(sections.source, false);
    assert.equal(sections.relatedMedia, false);
    assert.equal(sections.reviews, false);
    assert.equal(sections.similar, false);
    assert.equal(sections.description, false);
    assert.equal(sections.specs, false);
    assert.equal(sections.compare, true);
  });

  it('hydrates canonical buying and discovered listing offers', () => {
    const canonical = hydrateProductPage({
      productId: 'cat-1',
      shoppingProductId: 'cat-1',
      title: 'Headphones',
      offers: [
        {
          id: 'o1',
          merchant: 'Sony Store',
          price: '299',
          currency: 'USD',
          availability: 'In stock',
          action: 'buy',
        },
      ],
      canShop: true,
      specifications: {},
      relatedMedia: [],
      source: {
        contentSourceId: 'cs-1',
        userImportId: 'imp-1',
        kind: 'reel',
        label: 'Found from this Reel',
        url: 'https://www.instagram.com/reel/ABC/',
        title: null,
      },
    });
    assert.equal(canonical?.canShop, true);
    assert.equal(productPageOfferCta(canonical!.offers[0]!), PRODUCT_PAGE_COPY.buy);
    assert.equal(canonical?.offers[0]?.availability, 'In stock');
    assert.equal(canonical?.source?.label, 'Found from this Reel');

    const discovered = hydrateProductPage({
      productId: 'disc-1',
      shoppingProductId: null,
      title: 'Mug',
      offers: [
        { id: 'o2', merchant: 'Acme', price: '12', currency: 'USD', availability: null, action: 'listing' },
      ],
      canShop: true,
      specifications: {},
      relatedMedia: [],
    });
    assert.equal(discovered?.shoppingProductId, null);
    assert.equal(productPageOfferCta(discovered!.offers[0]!), PRODUCT_PAGE_COPY.buy);
  });

  it('does not let the client pick a merchant URL', () => {
    const click = readFileSync(join(ROOT, 'src/services/shoppingClick.ts'), 'utf8');
    const page = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    const collection = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    assert.match(click, /offerId/);
    assert.match(click, /\/products\/\$\{encodeURIComponent\(context\.catalogProductId\)\}\/redirect/);
    assert.doesNotMatch(click, /merchantUrl|amazon\.|flipkart\./);
    assert.match(page, /offerId,/);
    assert.doesNotMatch(page, /merchantUrl/);
    assert.match(collection, /openProductShopping/);
    assert.doesNotMatch(collection, /offerId/);
  });

  it('hydrates a review summary without inventing a rating', () => {
    const page = hydrateProductPage({
      productId: 'cat-1',
      shoppingProductId: 'cat-1',
      title: 'Headphones',
      offers: [],
      canShop: true,
      specifications: {},
      relatedMedia: [],
      reviews: {
        overview: 'Comfortable everyday headphones.',
        likes: ['Comfortable for long sessions'],
        concerns: ['Weaker isolation'],
        sources: [{ name: 'TechRadar', url: 'https://www.techradar.com/reviews/xm5' }],
        rating: null,
        reviewCount: null,
      },
    });
    assert.ok(page?.reviews);
    assert.equal(productPageSections(page!).reviews, true);
    assert.equal(productPageRatingLabel(page!.reviews!), null);
    assert.equal(productAiReviewFromPage(page!)?.status, 'available');
    assert.deepEqual(page!.reviews?.likes, ['Comfortable for long sessions']);
    assert.equal(page!.reviews?.reviewCount, null);

    const discovered = hydrateProductPage({
      productId: 'disc-1',
      shoppingProductId: null,
      title: 'Mug',
      offers: [],
      canShop: false,
      specifications: {},
      relatedMedia: [],
    });
    assert.equal(discovered?.reviews, null);
    assert.equal(productPageSections(discovered!).reviews, false);
  });

  it('never uses verification or catalogue internals in Product Page copy', () => {
    for (const value of Object.values(PRODUCT_PAGE_COPY)) {
      assert.doesNotMatch(value, FORBIDDEN);
    }
  });

  it('Bag navigates to the Product Page and Collection still uses the sheet', () => {
    const cart = readFileSync(join(ROOT, 'app/cart.tsx'), 'utf8');
    const page = readFileSync(join(ROOT, 'app/product/[productId].tsx'), 'utf8');
    const screen = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    const collection = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    assert.match(cart, /productPagePath/);
    assert.doesNotMatch(cart, /ProductDetailsSheet/);
    assert.match(page, /fetchProductPage/);
    assert.match(page, /ProductPage/);
    assert.match(screen, /PRODUCT_PAGE_COPY\.offers/);
    assert.match(screen, /PRODUCT_PAGE_COPY\.discovery/);
    assert.match(screen, /PRODUCT_PAGE_COPY\.relatedMedia/);
    assert.match(screen, /ProductPageReviews/);
    assert.doesNotMatch(screen, /ProductAiReviewCard/);
    assert.match(screen, /relatedMediaPath/);
    assert.match(screen, /hideInternalStatus/);
    assert.match(screen, /comparePath/);
    assert.doesNotMatch(screen, /VerificationBadge/);
    assert.match(collection, /ProductDetailsSheet/);
    assert.match(collection, /ProductAiReviewCard/);
    assert.match(collection, /CollectionMediaReference/);
    assert.equal(relatedMediaPath({
      id: 'm1',
      kind: 'reel',
      label: 'Instagram Reel',
      url: 'https://www.instagram.com/reel/ABC/',
      title: null,
      thumbnailUrl: null,
      collectionId: 'col-1',
    }), '/reel/col-1');
  });
});
