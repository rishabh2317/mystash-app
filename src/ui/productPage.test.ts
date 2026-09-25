import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { hydrateProductPage } from '@/src/services/productPageMap';
import {
  PRODUCT_PAGE_COPY,
  PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS,
  catalogViewFromProductPage,
  collectionViewFromRelatedMedia,
  discoverySourcePath,
  discoveryWatchLabel,
  featuredMediaFromPage,
  productAiReviewFromPage,
  productPageBestPriceLabel,
  productPageBuyingFreshnessLine,
  productPageOfferCta,
  productPagePath,
  productPagePricesFromLabel,
  productPageRatingLabel,
  productPageSections,
  relatedMediaPath,
  relatedMediaPosterUrl,
  shouldPollProductPageDetails,
} from '@/src/ui/productPage';

const ROOT = process.cwd();
const FORBIDDEN = /discovered product|unverified|confidence|completeness|catalogue status|catalog status|ai status|verification/i;

describe('product page presentation', () => {
  it('hydrates detailsUpdating and drives polling gate', () => {
    const updating = hydrateProductPage({
      productId: 'p-up',
      title: 'Mug',
      offers: [],
      specifications: {},
      canShop: false,
      compareAvailable: true,
      detailsUpdating: true,
    });
    const done = hydrateProductPage({
      productId: 'p-done',
      title: 'Mug',
      offers: [],
      specifications: {},
      canShop: false,
      compareAvailable: true,
      detailsUpdating: false,
    });
    const missing = hydrateProductPage({
      productId: 'p-legacy',
      title: 'Mug',
      offers: [],
      specifications: {},
      canShop: false,
      compareAvailable: true,
    });
    assert.equal(updating?.detailsUpdating, true);
    assert.equal(done?.detailsUpdating, false);
    assert.equal(missing?.detailsUpdating, false);
    assert.equal(shouldPollProductPageDetails(updating), true);
    assert.equal(shouldPollProductPageDetails(done), false);
    assert.equal(shouldPollProductPageDetails(missing), false);
    assert.equal(shouldPollProductPageDetails(null), false);
    assert.ok(PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS >= 2000);
    assert.ok(PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS <= 3000);
    assert.equal(PRODUCT_PAGE_COPY.detailsUpdating, 'Updating details…');
  });

  it('polls Product Page only while details are updating and clears on unmount', () => {
    const screen = readFileSync(join(ROOT, 'app/product/[productId].tsx'), 'utf8');
    assert.match(screen, /shouldPollProductPageDetails/);
    assert.match(screen, /PRODUCT_PAGE_DETAILS_UPDATING_POLL_MS/);
    assert.match(screen, /setInterval/);
    assert.match(screen, /clearInterval/);
    assert.match(screen, /cancelled = true/);
    assert.match(screen, /detailsUpdating/);
    assert.doesNotMatch(screen, /enrichmentStatus|pipeline|verification/i);
    const page = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    assert.match(page, /PRODUCT_PAGE_COPY\.detailsUpdating/);
    assert.match(page, /page\.detailsUpdating/);
    assert.doesNotMatch(page, /enrichmentStatus|pipeline|verification/i);
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

  it('hides Compare when compareAvailable is false', () => {
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
      compareAvailable: false,
    });
    assert.ok(page);
    assert.equal(productPageSections(page!).compare, false);
    const ui = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    assert.match(ui, /sections\.compare/);
    assert.doesNotMatch(ui, /compareAvailable\s*\|\|/);
  });

  it('builds buying summary labels without inventing prices', () => {
    assert.equal(productPagePricesFromLabel([]), null);
    assert.equal(
      productPagePricesFromLabel([{ price: '199', currency: 'INR' }]),
      `${PRODUCT_PAGE_COPY.pricesFrom} INR 199`,
    );
    assert.equal(
      productPageBestPriceLabel([{ price: '199', currency: 'INR' }]),
      null,
    );
    assert.equal(
      productPageBestPriceLabel([
        { price: '299', currency: 'INR' },
        { price: '199', currency: 'INR' },
      ]),
      `${PRODUCT_PAGE_COPY.bestPrice} INR 199`,
    );
    assert.equal(productPageBuyingFreshnessLine(['stored', 'stored']), null);
    assert.equal(
      productPageBuyingFreshnessLine(['live', 'stored']),
      PRODUCT_PAGE_COPY.pricesCheckedNow,
    );
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
        collectionId: null,
      },
    });
    assert.equal(canonical?.canShop, true);
    assert.equal(productPageOfferCta(canonical!.offers[0]!), PRODUCT_PAGE_COPY.buy);
    assert.equal(canonical?.offers[0]?.availability, 'In stock');
    assert.equal(canonical?.source?.label, 'Found from this Reel');
    assert.equal(canonical?.source?.collectionId, null);

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
    const browser = readFileSync(join(ROOT, 'app/merchant-browser.tsx'), 'utf8');
    assert.match(click, /offerId/);
    assert.match(click, /\/products\/\$\{encodeURIComponent\(context\.catalogProductId\)\}\/redirect/);
    assert.match(click, /merchantBrowserPath/);
    assert.match(click, /format.*json|format', 'json'/);
    assert.doesNotMatch(click, /amazon\.|flipkart\./);
    assert.match(page, /offerId/);
    assert.match(page, /fetchLivePrices/);
    assert.match(page, /openProductShopping/);
    assert.doesNotMatch(page, /amazon\.|flipkart\./);
    assert.match(collection, /openProductShopping/);
    assert.match(collection, /offerId/);
    assert.doesNotMatch(collection, /amazon\.|flipkart\./);
    assert.match(browser, /react-native-webview/);
    assert.match(browser, /onShouldStartLoadWithRequest/);
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
    const stash = readFileSync(join(ROOT, 'app/(tabs)/stash.tsx'), 'utf8');
    const page = readFileSync(join(ROOT, 'app/product/[productId].tsx'), 'utf8');
    const screen = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    const collection = readFileSync(join(ROOT, 'components/collection/CollectionScreen.tsx'), 'utf8');
    assert.match(stash, /productPagePath/);
    assert.doesNotMatch(stash, /ProductDetailsSheet/);
    assert.match(page, /fetchProductPage/);
    assert.match(page, /ProductPage/);
    assert.match(screen, /PRODUCT_PAGE_COPY\.offers/);
    assert.match(screen, /PRODUCT_PAGE_COPY\.relatedMedia/);
    assert.match(screen, /PRODUCT_PAGE_COPY\.discoveryTag/);
    assert.match(screen, /featuredMediaFromPage/);
    assert.match(screen, /ProductAiReviewCard/);
    assert.match(screen, /variant="standalone"/);
    assert.match(screen, /PublicCollectionTile/);
    assert.doesNotMatch(screen, /variant="creatorRail"/);
    assert.match(screen, /relatedMediaPath/);
    assert.match(screen, /hideInternalStatus/);
    assert.match(screen, /comparePath/);
    assert.doesNotMatch(screen, /ProductSourceMedia/);
    assert.doesNotMatch(screen, /VerificationBadge/);
    assert.doesNotMatch(screen, /ProductPageReviews/);
    assert.doesNotMatch(screen, /openBrowserAsync/);
    assert.doesNotMatch(collection, /ProductAiReviewCard/);
    assert.match(collection, /CollectionMediaReference/);
    assert.match(collection, /productPagePath/);
    assert.doesNotMatch(collection, /ProductDetailsSheet/);
    assert.equal(relatedMediaPath({ collectionId: 'col-1' }), '/reel/col-1');
  });

  it('puts discovery inside Featured and keeps AI Review available for discovered ids', () => {
    const page = hydrateProductPage({
      productId: 'disc-1',
      shoppingProductId: null,
      title: 'Pixel 10',
      offers: [],
      canShop: false,
      specifications: {},
      relatedMedia: [
        {
          id: 'm2',
          kind: 'short',
          label: 'YouTube Short',
          url: 'https://www.youtube.com/shorts/OTHER',
          title: 'Creator short',
          thumbnailUrl: null,
          collectionId: 'col-2',
          creator: { id: 'u1', username: 'creator', displayName: 'Creator', avatarUrl: null },
          views: 1200,
          saves: 3,
        },
      ],
      source: {
        contentSourceId: 'cs-1',
        userImportId: 'imp-1',
        kind: 'short',
        label: 'Found from this Short',
        url: 'https://www.youtube.com/shorts/DISCOVERY',
        title: null,
        collectionId: 'col-1',
      },
      compareAvailable: true,
    });
    assert.ok(page);
    const featured = featuredMediaFromPage(page!);
    assert.equal(featured[0]?.fromDiscovery, true);
    assert.equal(featured[0]?.collectionId, 'col-1');
    assert.equal(featured.length, 2);
    assert.equal(productPageSections(page!).featured, true);
    assert.equal(catalogViewFromProductPage(page!).catalogProductId, 'disc-1');

    const screen = readFileSync(join(ROOT, 'components/product/ProductPage.tsx'), 'utf8');
    assert.match(screen, /showAiBanner = Boolean\(page\.shoppingProductId \?\? page\.productId\)/);
    assert.match(screen, /ProductAiReviewCard[\s\S]*PRODUCT_PAGE_COPY\.relatedMedia/);
  });

  it('maps related media creator and views into CollectionTile models', () => {
    assert.equal(
      relatedMediaPosterUrl({
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        thumbnailUrl: null,
      }),
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    const view = collectionViewFromRelatedMedia({
      id: 'm1',
      kind: 'short',
      label: 'YouTube Short',
      url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      title: 'Pixel short',
      thumbnailUrl: null,
      collectionId: 'col-9',
      creator: { id: 'c1', username: 'pixel', displayName: 'Pixel Lab', avatarUrl: null },
      views: 4200,
      saves: 12,
    });
    assert.equal(view.collectionId, 'col-9');
    assert.equal(view.title, 'Pixel short');
    assert.equal(view.creator.displayName, 'Pixel Lab');
    assert.equal(view.counters.views, 4200);
    assert.match(view.heroThumbnailUrl ?? '', /hqdefault/);
    assert.equal(
      discoverySourcePath({
        contentSourceId: 'cs-1',
        userImportId: null,
        kind: 'short',
        label: 'Found from this Short',
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        title: null,
        collectionId: 'col-pixel',
      }),
      '/reel/col-pixel',
    );
    assert.equal(discoveryWatchLabel({ kind: 'short', collectionId: null }), 'Watch on YT');
  });
});
