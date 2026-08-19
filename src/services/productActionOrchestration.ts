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

/**
 * Auth-gated Add to Cart boundary.
 * Authenticated → Cart API via boundary / CartContext.
 * Unauthenticated → Login with route intent (OD-12).
 */
export function useProductAddToCartHandler() {
  const { user } = useAuth();
  const cart = useCartOptional();
  const router = useRouter();

  return useCallback(
    (product: CatalogProductViewModel) => {
      if (!product.catalogProductId) {
        Alert.alert('Unavailable', 'This product cannot be added to cart yet.');
        return;
      }
      if (user) {
        const id = product.catalogProductId;
        void (cart ? cart.addItem(id) : requestAddToCart(id)).catch((e) => {
          Alert.alert('Cart', e instanceof Error ? e.message : 'Could not add to cart.');
        });
        return;
      }
      const loginHref = buildAddToCartLoginHref(product.catalogProductId);
      if (!loginHref) {
        Alert.alert('Unavailable', 'This product cannot be added to cart yet.');
        return;
      }
      router.push(loginHref);
    },
    [cart, router, user],
  );
}
