import type { CollectionTagRemapPort } from '../catalog/ports';
import type { CartService } from './CartService';

/** Adapter: Catalog merge → CartItem FK remapping. */
export function createCartItemRemapPort(cart: CartService): CollectionTagRemapPort {
  return {
    async remapCatalogProduct(sourceId, targetId) {
      return cart.remapAfterCatalogMerge(sourceId, targetId);
    },
  };
}
