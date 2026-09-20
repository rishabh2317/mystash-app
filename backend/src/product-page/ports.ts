import type { DiscoveredProductRecord } from '../discovered/domain/types';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import type { ContentSourceRecord } from '../content-source/domain/types';
import type { ProductPageRelatedMedia, ProductPageReviews } from './domain/types';

export type ProductPageCatalogPort = {
  resolveActiveProduct(id: string): Promise<CatalogProduct | null>;
};

export type ProductPageDiscoveredPort = {
  getById(id: string): Promise<DiscoveredProductRecord | null>;
};

export type ProductPageContentSourcePort = {
  getById(id: string): Promise<ContentSourceRecord | null>;
  listBoundSourceIds(bind: {
    catalogProductId?: string | null;
    discoveredProductId?: string | null;
  }): Promise<string[]>;
};

export type ProductPageRelatedMediaPort = {
  listForCatalogProduct(catalogProductId: string, limit: number): Promise<ProductPageRelatedMedia[]>;
  listMatchingUrls(urls: string[], limit: number): Promise<ProductPageRelatedMedia[]>;
};

export type ProductPageShopPort = {
  canShopCatalog(product: CatalogProduct): boolean;
};

export type ProductPageReviewPort = {
  findReady(catalogProductId: string): Promise<ProductPageReviews | null>;
};

export const emptyReviewPort: ProductPageReviewPort = {
  async findReady() {
    return null;
  },
};
