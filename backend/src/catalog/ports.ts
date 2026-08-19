/**
 * Collection BC remaps Tag FKs after Catalog merge.
 * Catalog does not write CollectionProductTag rows.
 */
export type CollectionTagRemapPort = {
  remapCatalogProduct(sourceId: string, targetId: string): Promise<{
    remapped: number;
    collisionsResolved: number;
  }>;
};

export const noopCollectionTagRemap: CollectionTagRemapPort = {
  async remapCatalogProduct() {
    return { remapped: 0, collisionsResolved: 0 };
  },
};

/** Compose Collection + Cart (and future peers) remaps after Catalog merge. */
export function composeCollectionTagRemaps(
  ...ports: CollectionTagRemapPort[]
): CollectionTagRemapPort {
  return {
    async remapCatalogProduct(sourceId, targetId) {
      let remapped = 0;
      let collisionsResolved = 0;
      for (const port of ports) {
        const result = await port.remapCatalogProduct(sourceId, targetId);
        remapped += result.remapped;
        collisionsResolved += result.collisionsResolved;
      }
      return { remapped, collisionsResolved };
    },
  };
}
