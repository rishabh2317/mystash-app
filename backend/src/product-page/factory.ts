import type { SupabaseClient } from '@supabase/supabase-js';
import { createCatalogService } from '../catalog/factory';
import { createContentSourceService } from '../content-source/factory';
import { createDiscoveredProductService } from '../discovered/factory';
import { AffiliateService } from '../shopping/AffiliateService';
import { getAffiliateConfig } from '../shopping/affiliateConfig';
import { ShoppingResolver } from '../shopping/ShoppingResolver';
import { SupabaseProductAiReviewRepository } from '../ai-review/SupabaseProductAiReviewRepository';
import { projectReadyReview } from './domain/reviews';
import { ProductPageService } from './ProductPageService';
import { createSupabaseRelatedMediaPort } from './relatedMedia';

export function createProductPageService(admin: SupabaseClient): ProductPageService {
  const catalog = createCatalogService(admin);
  const discovered = createDiscoveredProductService(admin);
  const contentSources = createContentSourceService(admin);
  const resolver = new ShoppingResolver(new AffiliateService(getAffiliateConfig()));
  const reviewRepo = new SupabaseProductAiReviewRepository(admin);
  return new ProductPageService(
    { resolveActiveProduct: (id) => catalog.resolveActiveProduct(id) },
    { getById: (id) => discovered.getById(id) },
    {
      getById: (id) => contentSources.getById(id),
      listBoundSourceIds: (bind) => contentSources.listBoundSourceIds(bind),
    },
    { canShopCatalog: (product) => Boolean(resolver.resolve(product)) },
    createSupabaseRelatedMediaPort(admin),
    {
      findReady: async (catalogProductId) =>
        projectReadyReview(await reviewRepo.findByProductId(catalogProductId)),
    },
  );
}

export { ProductPageService, ProductPageServiceError } from './ProductPageService';
