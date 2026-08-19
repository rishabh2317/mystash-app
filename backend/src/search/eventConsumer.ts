/**
 * Async indexing entry points matching write-domain events.
 * Callers (Collection / Catalog / User / Engagement nearline) invoke these —
 * never synchronous inside foundational write request paths if avoidable.
 */
import type { SearchService } from './SearchService';
import type { CollectionIndexInput, CreatorIndexInput, ProductIndexInput } from './documents';

export type SearchEventConsumer = {
  onCollectionPublishedOrUpdated(input: CollectionIndexInput): Promise<void>;
  onCollectionUnsearchable(collectionId: string): Promise<void>;
  onCreatorUpdated(input: CreatorIndexInput): Promise<void>;
  onCreatorSnapshotFanout(params: {
    creatorId: string;
    displayName: string | null;
    username: string | null;
    avatarRef: string | null;
    collectionIds: string[];
  }): Promise<void>;
  onProductUpsert(input: ProductIndexInput): Promise<void>;
  onProductRemoved(catalogProductId: string): Promise<void>;
  onCollectionEngagementNearline(
    collectionId: string,
    mirrors: {
      viewsCount?: number;
      savesCount?: number;
      sharesCount?: number;
      productClicksCount?: number;
      creatorAuthority?: number;
      saveRate?: number | null;
    },
  ): Promise<void>;
};

export function createSearchEventConsumer(search: SearchService): SearchEventConsumer {
  return {
    async onCollectionPublishedOrUpdated(input) {
      await search.indexCollection(input);
    },
    async onCollectionUnsearchable(collectionId) {
      await search.deleteEntity('collection', collectionId);
    },
    async onCreatorUpdated(input) {
      await search.indexCreator(input);
    },
    async onCreatorSnapshotFanout(params) {
      await search.refreshCreatorSnapshotOnCollections(params);
    },
    async onProductUpsert(input) {
      await search.indexProduct(input);
    },
    async onProductRemoved(catalogProductId) {
      await search.deleteEntity('product', catalogProductId);
    },
    async onCollectionEngagementNearline(collectionId, mirrors) {
      await search.applyCollectionEngagementMirrors(collectionId, mirrors);
    },
  };
}
