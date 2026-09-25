/**
 * Search discover landing hydration — uses existing collection/creator APIs.
 * Kept separate from pure `searchDiscoverUx` so unit tests stay RN-free.
 */

import { videosToExploreCollections } from '@/src/mappers/exploreCollectionMapper';
import type { Video } from '@/src/mocks/videos';
import {
  fetchCollectionById,
  listCreatorProducts,
} from '@/src/services/collectionApi';
import { fetchPublicCreatorByUsername } from '@/src/services/userApi';
import type { CollectionViewModel } from '@/src/types/collection';
import {
  buildCreatorProductShelfSeeds,
  collectRecentFeedProducts,
  productPreviewUri,
  SEARCH_DISCOVER_POSTS_LIMIT,
  type CreatorProductShelf,
  type CreatorShelfSeed,
  type SearchDiscoverLanding,
} from '@/src/ui/searchDiscoverUx';

async function hydratePostViews(posts: CollectionViewModel[]): Promise<CollectionViewModel[]> {
  return Promise.all(
    posts.map(async (post) => {
      try {
        const agg = await fetchCollectionById(post.collectionId);
        return {
          ...post,
          title: post.title ?? agg.collection.title,
          heroThumbnailUrl: post.heroThumbnailUrl ?? agg.collection.heroThumbnailUrl,
          productCount: Math.max(post.productCount, agg.tags?.length ?? 0),
          creator: {
            ...post.creator,
            id: agg.collection.creatorId || post.creator.id,
            username: agg.collection.creatorUsername ?? post.creator.username,
            displayName: agg.collection.creatorName ?? post.creator.displayName,
            avatarUrl: agg.collection.creatorAvatar ?? post.creator.avatarUrl,
          },
          counters: {
            views: Math.max(0, Math.floor(agg.collection.viewsCount ?? 0)),
            saves: Math.max(0, Math.floor(agg.collection.savesCount ?? 0)),
          },
        };
      } catch {
        return post;
      }
    }),
  );
}

async function hydrateOneCreatorShelf(seed: CreatorShelfSeed): Promise<CreatorProductShelf | null> {
  let username = seed.username;
  let creatorId = seed.creatorId;
  let displayName = seed.displayName;
  let followers = 0;
  let productCount = seed.feedProductCount;
  let previewUrls = seed.previewUrls;

  if (!username && seed.sampleCollectionId) {
    try {
      const agg = await fetchCollectionById(seed.sampleCollectionId);
      username = agg.collection.creatorUsername?.trim() || username;
      creatorId = agg.collection.creatorId || creatorId;
      displayName =
        agg.collection.creatorName?.trim() ||
        (username ? `@${username}` : displayName);
    } catch {
      /* keep seed */
    }
  }

  if (username) {
    try {
      const creator = await fetchPublicCreatorByUsername(username);
      username = creator.username;
      creatorId = creator.userId;
      displayName = creator.displayName?.trim() || `@${creator.username}`;
      followers = Math.max(0, creator.followersCount ?? 0);
    } catch {
      /* keep seed identity */
    }
  }

  if (creatorId) {
    try {
      const page = await listCreatorProducts(creatorId, { limit: 8 });
      if (page.products.length > 0) {
        previewUrls = page.products
          .slice(0, 4)
          .map((p) => productPreviewUri(p.heroImage));
        productCount = Math.max(productCount, page.products.length);
        if (page.nextCursor) {
          productCount = Math.max(productCount, seed.feedProductCount);
        }
      }
    } catch {
      /* keep feed previews */
    }
  }

  if (!username) return null;

  return {
    username,
    title: displayName.replace(/^@/, ''),
    productCount,
    previewUrls,
    followers,
  };
}

async function hydrateCreatorShelves(seeds: CreatorShelfSeed[]): Promise<CreatorProductShelf[]> {
  const results = await Promise.all(seeds.map((seed) => hydrateOneCreatorShelf(seed)));
  return results.filter((shelf): shelf is CreatorProductShelf => shelf != null);
}

/**
 * Build Search landing discovery shelves from the chronological Home feed,
 * hydrating collection views and creator shelves in parallel via existing APIs.
 */
export async function loadSearchDiscoverLanding(
  videos: Video[],
): Promise<SearchDiscoverLanding> {
  const postSeeds = videosToExploreCollections(videos).slice(0, SEARCH_DISCOVER_POSTS_LIMIT);
  const shelfSeeds = buildCreatorProductShelfSeeds(videos);

  const [posts, productCollections] = await Promise.all([
    hydratePostViews(postSeeds),
    hydrateCreatorShelves(shelfSeeds),
  ]);

  return {
    posts,
    productCollections,
    products: collectRecentFeedProducts(videos),
  };
}
