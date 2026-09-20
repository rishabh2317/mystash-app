/**
 * Authenticated Add-to-Cart boundary used by orchestration + intent resume.
 * HTTP via cartApi; CartContext.refresh keeps UI in sync when mounted.
 */
import {
  addCartItem,
  removeCartItem,
  type CartItemSource,
  type RemoveCartItemReason,
} from '@/src/services/cartApi';

type CartRefresh = () => Promise<void>;

let refreshHandler: CartRefresh | null = null;

/** CartProvider registers so intent-resume / orchestration stay single-path. */
export function registerCartRefreshHandler(handler: CartRefresh | null): void {
  refreshHandler = handler;
}

export async function requestAddToCart(
  catalogProductId: string,
  source?: CartItemSource | null,
): Promise<void> {
  const id = catalogProductId.trim();
  if (!id) {
    if (__DEV__) {
      console.warn('[cart-boundary] refused empty catalogProductId');
    }
    return;
  }
  await addCartItem(id, source);
  if (refreshHandler) {
    await refreshHandler();
  }
}

export async function requestRemoveFromCart(
  catalogProductId: string,
  reason: RemoveCartItemReason = 'user_remove',
): Promise<void> {
  const id = catalogProductId.trim();
  if (!id) {
    if (__DEV__) {
      console.warn('[cart-boundary] refused empty catalogProductId');
    }
    return;
  }
  await removeCartItem(id, reason);
  if (refreshHandler) {
    await refreshHandler();
  }
}
