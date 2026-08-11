/**
 * Phase 1 Cart boundary — not a Cart implementation.
 *
 * Phase 2 will replace this with the authenticated DB-backed Cart service.
 * Callers must already have authenticated the user and validated catalogProductId.
 */
export function requestAddToCart(catalogProductId: string): void {
  if (!catalogProductId.trim()) {
    if (__DEV__) {
      console.warn('[cart-boundary] refused empty catalogProductId');
    }
    return;
  }
  if (__DEV__) {
    console.log('[cart-boundary] addToCart deferred to Phase 2', { catalogProductId });
  }
}
