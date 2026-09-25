import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { Video } from '@/src/mocks/videos';
import {
  buildCreatorProductShelfSeeds,
  buildSearchDiscoverLanding,
  collectRecentFeedProducts,
  creatorProductShelfHref,
  creatorProductShelfMetaLabel,
  creatorProductShelfToStashCategoryCard,
  creatorShelfFollowersLabel,
  SEARCH_DISCOVER_COPY,
  searchDiscoverHasContent,
} from '@/src/ui/searchDiscoverUx';

const ROOT = process.cwd();

function video(partial: Partial<Video> & Pick<Video, 'id'>): Video {
  return {
    url: 'https://example.com/v',
    thumbnail: 'https://example.com/t.jpg',
    creator_name: 'Creator',
    stash_score: 1,
    product_name: 'Item',
    collection_id: `col-${partial.id}`,
    video_title: `Title ${partial.id}`,
    products: [],
    ...partial,
  };
}

describe('Search Discover UX wiring', () => {
  it('uses mode switch, Paste URL import path, Activity, and Stash typography', () => {
    const search = readFileSync(join(ROOT, 'app/(tabs)/search.tsx'), 'utf8');
    assert.match(search, /SearchModeSwitch/);
    assert.match(search, /Paste a product, Reel or Short URL/);
    assert.match(search, /Search products, creators, collections/);
    assert.match(search, /submitUserImport/);
    assert.match(search, /extractSharedLink/);
    assert.match(search, /shareActivityLandingItems/);
    assert.match(search, /ShareActivityCard/);
    assert.match(search, /\/shares/);
    assert.match(search, /productPagePath/);
    assert.match(search, /typeStyle/);
    assert.match(search, /SectionHeader/);
    assert.match(search, /buildSearchDiscoverLanding/);
    assert.match(search, /loadSearchDiscoverLanding/);
    assert.match(search, /searchDiscoverLoad/);
    assert.match(search, /fetchVideos/);
    assert.match(search, /onBecameReady/);
    assert.match(search, /refreshCart/);
    assert.match(search, /StashCategoryCard/);
    assert.match(search, /ContentRail/);
    assert.match(search, /itemGap/);
    assert.match(search, /PublicCollectionTile/);
    assert.match(search, /creatorProductShelfHref/);
    assert.match(search, /variant=\"related\"/);
    assert.doesNotMatch(search, /ProductDetailsSheet/);
  });

  it('creator profile opens Products tab from deep link', () => {
    const creator = readFileSync(join(ROOT, 'app/creator/[username].tsx'), 'utf8');
    assert.match(creator, /tabParam === 'products'/);
    assert.match(creator, /CreatorProfileTab/);
  });

  it('Your Shares and Search Activity use the same expandable card', () => {
    const shares = readFileSync(join(ROOT, 'app/shares.tsx'), 'utf8');
    const search = readFileSync(join(ROOT, 'app/(tabs)/search.tsx'), 'utf8');
    const card = readFileSync(join(ROOT, 'components/search/ShareActivityCard.tsx'), 'utf8');
    assert.match(shares, /ShareActivityCard/);
    assert.match(shares, /expandable/);
    assert.match(shares, /onRetry/);
    assert.match(shares, /onDelete/);
    assert.match(search, /ShareActivityCard/);
    assert.match(search, /expandable/);
    assert.match(search, /onRetryShare/);
    assert.doesNotMatch(search, /shareActivityDestination/);
    assert.match(card, /viewInBag|View in Bag/);
    assert.match(card, /SHARE_ACTIVITY_COPY\.retry/);
    assert.match(card, /SHARE_ACTIVITY_COPY\.delete/);
    assert.match(card, /Alert\.alert/);
  });
});

describe('buildCreatorProductShelfSeeds', () => {
  it('groups shelves by creator username with product previews', () => {
    const seeds = buildCreatorProductShelfSeeds([
      video({
        id: '1',
        curator_id: '@styleexpert',
        creator_name: 'Style Expert',
        products: [
          {
            id: 'p1',
            name: 'Dress',
            price: '$40',
            image: 'https://example.com/p1.jpg',
            catalog_product_id: 'cat-1',
          },
        ],
      }),
      video({
        id: '2',
        curator_id: '@styleexpert',
        creator_name: 'Style Expert',
        products: [
          {
            id: 'p2',
            name: 'Bag',
            price: '$20',
            image: 'https://example.com/p2.jpg',
            catalog_product_id: 'cat-2',
          },
        ],
      }),
      video({
        id: '3',
        curator_id: '@techguru',
        creator_name: 'Tech',
        products: [
          {
            id: 'p3',
            name: 'Gimbal',
            price: '$99',
            image: 'https://example.com/p3.jpg',
          },
        ],
      }),
    ]);

    assert.equal(seeds.length, 2);
    assert.equal(seeds[0]?.username, 'styleexpert');
    assert.equal(seeds[0]?.feedProductCount, 2);
    assert.equal(seeds[0]?.previewUrls.length, 2);
    assert.equal(seeds[1]?.username, 'techguru');
  });

  it('skips videos without a resolvable creator handle or uuid', () => {
    const seeds = buildCreatorProductShelfSeeds([
      video({
        id: 'x',
        curator_id: undefined,
        products: [{ id: 'p', name: 'X', price: '$1', image: 'https://example.com/x.jpg' }],
      }),
    ]);
    assert.equal(seeds.length, 0);
  });
});

describe('buildSearchDiscoverLanding', () => {
  it('returns empty shelves when feed is empty', () => {
    const landing = buildSearchDiscoverLanding([]);
    assert.deepEqual(landing, { posts: [], productCollections: [], products: [] });
    assert.equal(searchDiscoverHasContent(landing), false);
  });

  it('maps posts and creator product shelves from feed', () => {
    const landing = buildSearchDiscoverLanding([
      video({
        id: '1',
        collection_id: 'col-a',
        curator_id: '@styleexpert',
        creator_name: 'Style Expert',
        video_title: 'Summer edit',
        products: [
          {
            id: 'p1',
            name: 'Dress',
            price: '$40',
            image: 'https://example.com/p1.jpg',
            catalog_product_id: 'cat-1',
          },
          {
            id: 'p2',
            name: 'Bag',
            price: '$20',
            image: 'https://example.com/p2.jpg',
            catalog_product_id: 'cat-2',
          },
        ],
      }),
      video({
        id: '2',
        collection_id: 'col-b',
        video_title: 'Desk setup',
        products: [],
      }),
    ]);

    assert.equal(landing.posts.length, 2);
    assert.equal(landing.posts[0]?.collectionId, 'col-a');
    assert.equal(landing.productCollections.length, 1);
    assert.equal(landing.productCollections[0]?.username, 'styleexpert');
    assert.equal(landing.productCollections[0]?.title, 'Style Expert');
    assert.equal(landing.productCollections[0]?.productCount, 2);
    assert.equal(landing.productCollections[0]?.followers, 0);
    assert.equal(landing.products.length, 2);
    assert.ok(searchDiscoverHasContent(landing));
    assert.equal(SEARCH_DISCOVER_COPY.productCollections, 'Product collections');
  });
});

describe('creator product shelf helpers', () => {
  it('builds products-tab deep link and followers label', () => {
    assert.equal(creatorProductShelfHref('Ada'), '/creator/Ada?tab=products');
    assert.equal(creatorShelfFollowersLabel(1), '1 follower');
    assert.equal(creatorShelfFollowersLabel(1200), '1.2K followers');
  });

  it('maps CreatorProductShelf to Stash collage model at the edge', () => {
    const shelf = {
      username: 'styleexpert',
      title: 'Style Expert',
      productCount: 2,
      previewUrls: ['https://example.com/a.jpg', null],
      followers: 1200,
    };
    const card = creatorProductShelfToStashCategoryCard(shelf);
    assert.equal(card.key, 'styleexpert');
    assert.equal(card.title, 'Style Expert');
    assert.equal(card.count, 2);
    assert.deepEqual(card.items, []);
    assert.equal(creatorProductShelfMetaLabel(shelf), '1.2K followers · 2 products');
  });

  it('dedupes recent feed products via shared helper', () => {
    const products = collectRecentFeedProducts([
      video({
        id: '1',
        products: [
          {
            id: 'local-1',
            name: 'A',
            price: '$1',
            image: 'https://example.com/a.jpg',
            catalog_product_id: 'cat-1',
          },
        ],
      }),
      video({
        id: '2',
        products: [
          {
            id: 'local-2',
            name: 'A again',
            price: '$1',
            image: 'https://example.com/a.jpg',
            catalog_product_id: 'cat-1',
          },
          {
            id: 'local-3',
            name: 'B',
            price: '$2',
            image: 'https://example.com/b.jpg',
          },
        ],
      }),
    ]);
    assert.equal(products.length, 2);
    assert.equal(products[0]?.catalogProductId, 'cat-1');
    assert.equal(products[1]?.id, 'local-3');
  });
});
