import type { Collection } from '../collection/domain/types';
import type { CollectionIndexInput } from './documents';

/** Map Collection SoT → disposable CollectionSearchDocument input. */
export function collectionToSearchIndexInput(c: Collection): CollectionIndexInput {
  return {
    collectionId: c.id,
    slug: c.slug,
    searchTitle: c.searchTitle ?? c.title,
    searchText: c.searchText ?? c.caption,
    searchKeywords: c.searchKeywords,
    searchBrands: c.searchBrands,
    searchCategories: c.searchCategories,
    searchEligible: c.searchEligible,
    contentRevision: c.contentRevision,
    creator: {
      creatorId: c.creatorId,
      displayName: c.creatorName,
      username: c.creatorUsername,
      avatarRef: c.creatorAvatar,
    },
    primaryMediaRef: c.heroThumbnailUrl ?? c.primaryMediaId,
    productTagCount: c.productTagCount,
    publishedAt: c.publishedAt,
    qualityScore: c.qualityScore,
    viewsCount: c.viewsCount,
    savesCount: c.savesCount,
    sharesCount: c.sharesCount,
    productClicksCount: c.productClicksCount,
    creatorAuthority: 0,
    deleted: Boolean(c.deletedAt),
  };
}

/** Fire-and-forget Search projection update — never blocks write-domain success. */
export function scheduleSearchCollectionIndex(
  indexFn: (input: CollectionIndexInput) => Promise<void>,
  collection: Collection,
): void {
  void indexFn(collectionToSearchIndexInput(collection)).catch(() => {
    /* Search is eventually consistent; write path already succeeded */
  });
}

export function scheduleSearchCollectionDelete(
  deleteFn: (collectionId: string) => Promise<void>,
  collectionId: string,
): void {
  void deleteFn(collectionId).catch(() => {});
}
