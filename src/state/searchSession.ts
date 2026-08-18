/** Tab path for Search. Expo Router reports this when the Search tab is focused. */
export function isSearchTabPath(pathname: string): boolean {
  const p = pathname.split('?')[0] ?? '';
  return p === '/search' || p === '/(tabs)/search';
}

/**
 * Routes that belong to an in-progress Search flow (typed results → detail → back).
 * Home/Create/Profile are not part of that flow.
 */
export function isSearchFlowPath(pathname: string): boolean {
  const p = pathname.split('?')[0] ?? '';
  if (isSearchTabPath(p)) return true;
  return (
    p.startsWith('/collection/') ||
    p.startsWith('/creator/') ||
    p.startsWith('/reel/') ||
    p === '/cart' ||
    p.startsWith('/cart/') ||
    p.startsWith('/product-list/')
  );
}

/**
 * Reset typed Search query/results only when entering Search from outside the Search flow
 * (typically another tab). Keep state when returning from collection/creator/reel/cart.
 */
export function shouldResetSearchSession(prevPath: string | null, nextPath: string): boolean {
  if (!isSearchTabPath(nextPath)) return false;
  if (prevPath == null) return false;
  if (isSearchTabPath(prevPath)) return false;
  return !isSearchFlowPath(prevPath);
}
