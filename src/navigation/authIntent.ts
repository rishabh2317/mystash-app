/**
 * Route-level auth intent for resuming authenticated actions after Login.
 * OD-12 frozen: navigation/route params only — no global store, no AsyncStorage cart.
 *
 * Google OAuth cold-callback path carries the same params on redirectTo so
 * app/auth/callback can forward them to Profile without a second intent store.
 */

export const AUTH_INTENT_ADD_TO_CART = 'ADD_TO_CART' as const;

export type AuthIntentAction = typeof AUTH_INTENT_ADD_TO_CART;

export type AddToCartAuthIntent = {
  intent: typeof AUTH_INTENT_ADD_TO_CART;
  catalogProductId: string;
};

/** Expo Router / deep-link params that may carry an auth intent. */
export type ProfileAuthIntentParams = {
  intent?: string | string[];
  catalogProductId?: string | string[];
};

/** Opaque catalog ids: UUID or similar safe identifiers (reject URLs / path tricks). */
const CATALOG_PRODUCT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function isValidCatalogProductId(catalogProductId: string): boolean {
  const id = catalogProductId.trim();
  if (!id || id.length > 128) return false;
  if (id.includes('://') || id.includes('/') || id.includes('\\') || id.includes('..')) {
    return false;
  }
  return CATALOG_PRODUCT_ID_RE.test(id);
}

/**
 * Validate and normalize ADD_TO_CART intent. Unsupported / malformed → null.
 * Only ADD_TO_CART is supported in Phase 1.1.
 */
export function parseAddToCartIntent(
  params: ProfileAuthIntentParams,
): AddToCartAuthIntent | null {
  const intent = firstParam(params.intent)?.trim();
  const catalogProductId = firstParam(params.catalogProductId)?.trim();

  if (!intent || intent !== AUTH_INTENT_ADD_TO_CART) return null;
  if (!catalogProductId || !isValidCatalogProductId(catalogProductId)) return null;

  return { intent: AUTH_INTENT_ADD_TO_CART, catalogProductId };
}

export function buildAddToCartLoginHref(catalogProductId: string): {
  pathname: '/(tabs)/profile';
  params: AddToCartAuthIntent;
} | null {
  const parsed = parseAddToCartIntent({
    intent: AUTH_INTENT_ADD_TO_CART,
    catalogProductId,
  });
  if (!parsed) return null;
  return {
    pathname: '/(tabs)/profile',
    params: parsed,
  };
}

/**
 * Profile destination after auth completes.
 * Forwards validated ADD_TO_CART intent; otherwise plain Profile (no action).
 */
export function buildProfileHrefAfterAuth(params: ProfileAuthIntentParams): {
  pathname: '/(tabs)/profile';
  params?: AddToCartAuthIntent;
} {
  const intent = parseAddToCartIntent(params);
  if (!intent) {
    return { pathname: '/(tabs)/profile' };
  }
  return {
    pathname: '/(tabs)/profile',
    params: intent,
  };
}

/**
 * Embed validated route-level intent onto an OAuth redirectTo URL.
 * Supabase preserves redirectTo query params through the OAuth round-trip.
 * Does not use a second intent store.
 */
export function appendAuthIntentToRedirectUrl(
  redirectBaseUrl: string,
  intent: AddToCartAuthIntent | null | undefined,
): string {
  const validated = intent ? parseAddToCartIntent(intent) : null;
  if (!validated) return redirectBaseUrl;

  const hashIndex = redirectBaseUrl.indexOf('#');
  const beforeHash = hashIndex >= 0 ? redirectBaseUrl.slice(0, hashIndex) : redirectBaseUrl;
  const hash = hashIndex >= 0 ? redirectBaseUrl.slice(hashIndex) : '';
  const sep = beforeHash.includes('?') ? '&' : '?';
  return (
    `${beforeHash}${sep}` +
    `intent=${encodeURIComponent(validated.intent)}` +
    `&catalogProductId=${encodeURIComponent(validated.catalogProductId)}` +
    hash
  );
}
