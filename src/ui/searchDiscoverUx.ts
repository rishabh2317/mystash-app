/**
 * Search landing discovery — pure mapping over Home feed videos.
 * Async hydration lives in `searchDiscoverLoad.ts` (keeps unit tests RN-free).
 */

import { mapFeedProductToCatalogViewModel } from '@/src/mappers/feedProductMapper';
import { videosToExploreCollections } from '@/src/mappers/exploreCollectionMapper';
import type { Video } from '@/src/mocks/videos';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { StashCategoryCardModel } from '@/src/ui/bag';
import {
  creatorDisplayNameFromFeed,
  creatorUsernameFromFeed,
  isLikelyUserId,
} from '@/src/ui/feedCreatorIdentity';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';

export const SEARCH_DISCOVER_COPY = {
  latestPosts: 'Latest posts',
  latestCollections: 'Latest collections',
  productCollections: 'Product collections',
  recentProducts: 'Recent products',
  emptyHint: 'Search products, creators, and collections — or paste a link to discover products.',
} as const;

export const SEARCH_DISCOVER_POSTS_LIMIT = 12;
export const SEARCH_DISCOVER_SHELVES_LIMIT = 8;
export const SEARCH_DISCOVER_PRODUCTS_LIMIT = 12;

/** Creator product shelf for Search Product collections (not a Stash bag category). */
export type CreatorProductShelf = {
  username: string;
  title: string;
  productCount: number;
  previewUrls: (string | null)[];
  followers: number;
};

export type SearchDiscoverLanding = {
  /** Chronological reels / posts with a collection identity. */
  posts: CollectionViewModel[];
  /** Creator product shelves — collage → profile Products tab. */
  productCollections: CreatorProductShelf[];
  /** Deduped products tagged on latest feed items. */
  products: CatalogProductViewModel[];
};

export type CreatorShelfSeed = {
  /** Stable map key (username lowercased or creator UUID). */
  groupKey: string;
  username: string | null;
  creatorId: string | null;
  displayName: string;
  previewUrls: (string | null)[];
  feedProductCount: number;
  sampleCollectionId: string | null;
};

export function productPreviewUri(uri: string | undefined | null): string | null {
  return uri && uri.startsWith('http') ? uri : null;
}

/**
 * Deduped feed-tagged products for Recent products (and sync/async discover paths).
 * Prefer catalog id when present; otherwise product id.
 */
export function collectRecentFeedProducts(
  videos: Video[],
  limit: number = SEARCH_DISCOVER_PRODUCTS_LIMIT,
): CatalogProductViewModel[] {
  const products: CatalogProductViewModel[] = [];
  const seen = new Set<string>();
  for (const video of videos) {
    for (const product of video.products ?? []) {
      const catalogId = product.catalog_product_id?.trim();
      const dedupeKey = catalogId || product.id.trim();
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      products.push(mapFeedProductToCatalogViewModel(product));
      if (products.length >= limit) return products;
    }
  }
  return products;
}

/** Sync shelf seeds from feed — one row per distinct creator with tagged products. */
export function buildCreatorProductShelfSeeds(videos: Video[]): CreatorShelfSeed[] {
  const byKey = new Map<string, CreatorShelfSeed>();

  for (const video of videos) {
    const tagged = video.products ?? [];
    if (tagged.length === 0) continue;

    const username = creatorUsernameFromFeed(video);
    const curatorRaw = video.curator_id?.trim().replace(/^@/, '') || null;
    const creatorId = curatorRaw && isLikelyUserId(curatorRaw) ? curatorRaw : null;
    const groupKey = (username ?? creatorId)?.toLowerCase();
    if (!groupKey) continue;

    const existing = byKey.get(groupKey);
    const previews = tagged.map((p) => productPreviewUri(p.image));
    if (!existing) {
      byKey.set(groupKey, {
        groupKey,
        username,
        creatorId,
        displayName: creatorDisplayNameFromFeed(video),
        previewUrls: previews.slice(0, 4),
        feedProductCount: tagged.length,
        sampleCollectionId: video.collection_id?.trim() || null,
      });
      continue;
    }

    const seen = new Set(
      existing.previewUrls.filter((u): u is string => Boolean(u)),
    );
    for (const url of previews) {
      if (!url || seen.has(url) || existing.previewUrls.length >= 4) continue;
      existing.previewUrls.push(url);
      seen.add(url);
    }
    existing.feedProductCount += tagged.length;
    if (!existing.username && username) existing.username = username;
    if (!existing.creatorId && creatorId) existing.creatorId = creatorId;
    if (!existing.sampleCollectionId && video.collection_id?.trim()) {
      existing.sampleCollectionId = video.collection_id.trim();
    }
  }

  return [...byKey.values()].slice(0, SEARCH_DISCOVER_SHELVES_LIMIT);
}

/** Sync landing from feed (no network). Views stay 0 until hydrated. */
export function buildSearchDiscoverLanding(videos: Video[]): SearchDiscoverLanding {
  const posts = videosToExploreCollections(videos).slice(0, SEARCH_DISCOVER_POSTS_LIMIT);
  const seeds = buildCreatorProductShelfSeeds(videos);
  const productCollections: CreatorProductShelf[] = seeds
    .filter((s) => s.username)
    .map((s) => ({
      username: s.username!,
      title: s.displayName.replace(/^@/, ''),
      productCount: s.feedProductCount,
      previewUrls: s.previewUrls,
      followers: 0,
    }));

  return {
    posts,
    productCollections,
    products: collectRecentFeedProducts(videos),
  };
}

export function searchDiscoverHasContent(landing: SearchDiscoverLanding): boolean {
  return (
    landing.posts.length > 0 ||
    landing.productCollections.length > 0 ||
    landing.products.length > 0
  );
}

export function creatorProductShelfHref(username: string): string {
  const handle = username.trim().replace(/^@/, '');
  return `/creator/${encodeURIComponent(handle)}?tab=products`;
}

export function creatorShelfFollowersLabel(followers: number): string {
  const n = Math.max(0, Math.floor(followers));
  const count = formatEngagementCount(n);
  return n === 1 ? `${count} follower` : `${count} followers`;
}

/** Presentation-edge map: CreatorProductShelf → Stash collage card model. */
export function creatorProductShelfToStashCategoryCard(
  shelf: CreatorProductShelf,
): StashCategoryCardModel {
  return {
    key: shelf.username,
    title: shelf.title,
    count: shelf.productCount,
    previewUrls: shelf.previewUrls,
    items: [],
  };
}

/** Meta line for Search creator shelves (followers · products). */
export function creatorProductShelfMetaLabel(shelf: CreatorProductShelf): string {
  const countLabel =
    shelf.productCount === 1 ? '1 product' : `${shelf.productCount} products`;
  return `${creatorShelfFollowersLabel(shelf.followers)} · ${countLabel}`;
}
