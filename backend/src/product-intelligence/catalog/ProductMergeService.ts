/**
 * Product merge is owned by CatalogService.merge (Catalog BC).
 * This module remains as a thin adapter for older import sites.
 */
import type { CatalogService } from '../../catalog/CatalogService';

export type ProductMergeService = {
  merge(sourceId: string, targetId: string): Promise<void>;
};

export class CatalogServiceProductMergeAdapter implements ProductMergeService {
  constructor(private readonly catalog: CatalogService) {}

  async merge(sourceId: string, targetId: string): Promise<void> {
    await this.catalog.merge(sourceId, targetId);
  }
}

/** @deprecated Use CatalogService.merge — kept so older imports compile. */
export class UnimplementedProductMergeService implements ProductMergeService {
  async merge(): Promise<void> {
    throw new Error(
      'ProductMergeService: use CatalogService.merge — UnimplementedProductMergeService is retired',
    );
  }
}
