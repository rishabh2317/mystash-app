import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { useCartOptional } from '@/contexts/CartContext';
import { buildAddToCartLoginHref } from '@/src/navigation/authIntent';
import { requestAddToCart } from '@/src/services/cartBoundary';
import { openProductShopping } from '@/src/services/shoppingClick';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';

/**
 * Parent/orchestration helpers for Product callbacks.
 * ProductCard / ProductDetailsSheet must never call these hooks themselves.
 */

export function useProductBuyHandler() {
  return useCallback(async (product: CatalogProductViewModel) => {
    if (!product.catalogProductId) {
      Alert.alert('Link unavailable', 'No shopping destination is available for this product yet.');
      return;
    }
    try {
      await openProductShopping({ catalogProductId: product.catalogProductId });
    } catch {
      Alert.alert('Error', 'Could not open the product link.');
    }
  }, []);
}

export type AddToCartOutcome = 'added' | 'login' | 'unavailable';

/**
 * Auth-gated Add to Bag boundary (Cart API internally).
 * Authenticated → Cart API via boundary / CartContext.
 * Unauthenticated → Login with route intent (OD-12).
 * Does not Alert on success; callers own pending → success | error visuals.
 */
export function useProductAddToCartHandler() {
  const { user } = useAuth();
  const cart = useCartOptional();
  const router = useRouter();

  return useCallback(
    async (product: CatalogProductViewModel): Promise<AddToCartOutcome> => {
      if (!product.catalogProductId) {
        return 'unavailable';
      }
      if (user) {
        const id = product.catalogProductId;
        try {
          await (cart ? cart.addItem(id) : requestAddToCart(id));
          return 'added';
        } catch {
          return 'unavailable';
        }
      }
      const loginHref = buildAddToCartLoginHref(product.catalogProductId);
      if (!loginHref) {
        return 'unavailable';
      }
      router.push(loginHref);
      return 'login';
    },
    [cart, router, user],
  );
}
