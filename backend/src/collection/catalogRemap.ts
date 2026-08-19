import type { CollectionService } from './CollectionService';
import type { CollectionTagRemapPort } from '../catalog/ports';

/** Adapter: Catalog merge → Collection Tag FK remapping. */
export function createCollectionTagRemapPort(
  collections: CollectionService,
): CollectionTagRemapPort {
  return {
    async remapCatalogProduct(sourceId, targetId) {
      return collections.remapCatalogProductAfterMerge({ sourceId, targetId });
    },
  };
}
