import type { SupabaseClient } from '@supabase/supabase-js';
import { createCatalogService } from '../catalog/factory';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import { CartService } from './CartService';
import { createCartItemRemapPort } from './catalogRemap';
import { SupabaseCartRepository } from './SupabaseCartRepository';
import type { CatalogCartPort } from './ports';

export function createCatalogCartPort(admin: SupabaseClient): CatalogCartPort {
  const catalog = createCatalogService(admin);
  return {
    resolveActiveProduct: (id) => catalog.resolveActiveProduct(id),
    getById: (id) => catalog.getById(id),
    async getProductsByIds(ids: string[]): Promise<Map<string, CatalogProduct>> {
      const unique = [...new Set(ids.filter(Boolean))];
      const map = new Map<string, CatalogProduct>();
      await Promise.all(
        unique.map(async (id) => {
          const product = await catalog.getById(id);
          if (product) map.set(id, product);
        }),
      );
      return map;
    },
  };
}

export function createCartService(
  admin: SupabaseClient,
  catalogPort?: CatalogCartPort,
): CartService {
  return new CartService(
    new SupabaseCartRepository(admin),
    catalogPort ?? createCatalogCartPort(admin),
  );
}

export function createCartItemRemap(admin: SupabaseClient) {
  return createCartItemRemapPort(createCartService(admin));
}

export { CartService, CartServiceError } from './CartService';
export { InMemoryCartRepository } from './InMemoryCartRepository';
export { createCartItemRemapPort } from './catalogRemap';
export type { CatalogCartPort } from './ports';
