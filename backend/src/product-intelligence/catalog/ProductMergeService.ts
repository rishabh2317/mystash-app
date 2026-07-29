/**
 * Reserved for future duplicate catalog merges.
 * Preserves analytics, affiliate history, aliases, and redirects merged IDs.
 * Not implemented in Phase 2 — schema supports merged_into_id only.
 */
export type ProductMergeService = {
  merge(sourceId: string, targetId: string): Promise<void>;
};

export class UnimplementedProductMergeService implements ProductMergeService {
  async merge(): Promise<void> {
    throw new Error('ProductMergeService is reserved and not implemented yet');
  }
}
