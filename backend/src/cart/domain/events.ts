import type { CartItemSource, RemoveCartItemReason } from './types';

export type CartEventName = 'CartItemAdded' | 'CartItemRemoved';

export type CartEventPayload = {
  userId: string;
  catalogProductId: string;
  cartItemId: string | null;
  created?: boolean;
  reason?: RemoveCartItemReason;
  source?: CartItemSource | null;
};

export function buildCartEventPayload(
  partial: CartEventPayload,
): CartEventPayload {
  return {
    userId: partial.userId,
    catalogProductId: partial.catalogProductId,
    cartItemId: partial.cartItemId,
    created: partial.created,
    reason: partial.reason,
    source: partial.source ?? null,
  };
}
