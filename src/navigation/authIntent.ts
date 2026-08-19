/**
 * Route-level auth intent for resuming authenticated actions after Login.
 * OD-12 frozen: navigation/route params only — no global store, no AsyncStorage cart.
 *
 * Google OAuth cold-callback path carries the same params on redirectTo so
 * app/auth/callback can forward them to Profile without a second intent store.
 */

export const AUTH_INTENT_ADD_TO_CART = 'ADD_TO_CART' as const;
export const AUTH_INTENT_FOLLOW_CREATOR = 'FOLLOW_CREATOR' as const;
export const AUTH_INTENT_SAVE_COLLECTION = 'SAVE_COLLECTION' as const;

export type AuthIntentAction =
  | typeof AUTH_INTENT_ADD_TO_CART
  | typeof AUTH_INTENT_FOLLOW_CREATOR
  | typeof AUTH_INTENT_SAVE_COLLECTION;

export type AddToCartAuthIntent = {
  intent: typeof AUTH_INTENT_ADD_TO_CART;
  catalogProductId: string;
};

export type FollowCreatorAuthIntent = {
  intent: typeof AUTH_INTENT_FOLLOW_CREATOR;
  creatorId: string;
  /** Optional return handle for /creator/[username] after resume. */
  username?: string;
};

export type SaveCollectionAuthIntent = {
  intent: typeof AUTH_INTENT_SAVE_COLLECTION;
  collectionId: string;
};

export type AuthIntent =
  | AddToCartAuthIntent
  | FollowCreatorAuthIntent
  | SaveCollectionAuthIntent;

/** Expo Router / deep-link params that may carry an auth intent. */
export type ProfileAuthIntentParams = {
  intent?: string | string[];
  catalogProductId?: string | string[];
  creatorId?: string | string[];
  username?: string | string[];
  collectionId?: string | string[];
};

/** Opaque catalog ids: UUID or similar safe identifiers (reject URLs / path tricks). */
const CATALOG_PRODUCT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREATOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COLLECTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

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

export function isValidCreatorId(creatorId: string): boolean {
  const id = creatorId.trim();
  if (!id || id.length > 128) return false;
  if (id.includes('://') || id.includes('/') || id.includes('\\') || id.includes('..')) {
    return false;
  }
  return CREATOR_ID_RE.test(id);
}

export function isValidCollectionId(collectionId: string): boolean {
  const id = collectionId.trim();
  if (!id || id.length > 128) return false;
  if (id.includes('://') || id.includes('/') || id.includes('\\') || id.includes('..')) {
    return false;
  }
  return COLLECTION_ID_RE.test(id);
}

export function isValidUsername(username: string): boolean {
  const u = username.trim().replace(/^@/, '');
  if (!u || u.length > 64) return false;
  return USERNAME_RE.test(u);
}

/**
 * Validate and normalize ADD_TO_CART intent. Unsupported / malformed → null.
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

/**
 * Validate and normalize FOLLOW_CREATOR intent. Unsupported / malformed → null.
 */
export function parseFollowCreatorIntent(
  params: ProfileAuthIntentParams,
): FollowCreatorAuthIntent | null {
  const intent = firstParam(params.intent)?.trim();
  const creatorId = firstParam(params.creatorId)?.trim();
  const usernameRaw = firstParam(params.username)?.trim();

  if (!intent || intent !== AUTH_INTENT_FOLLOW_CREATOR) return null;
  if (!creatorId || !isValidCreatorId(creatorId)) return null;

  const username =
    usernameRaw && isValidUsername(usernameRaw) ? usernameRaw.replace(/^@/, '') : undefined;

  return {
    intent: AUTH_INTENT_FOLLOW_CREATOR,
    creatorId,
    ...(username ? { username } : {}),
  };
}

/**
 * Validate and normalize SAVE_COLLECTION intent. Unsupported / malformed → null.
 */
export function parseSaveCollectionIntent(
  params: ProfileAuthIntentParams,
): SaveCollectionAuthIntent | null {
  const intent = firstParam(params.intent)?.trim();
  const collectionId = firstParam(params.collectionId)?.trim();

  if (!intent || intent !== AUTH_INTENT_SAVE_COLLECTION) return null;
  if (!collectionId || !isValidCollectionId(collectionId)) return null;

  return { intent: AUTH_INTENT_SAVE_COLLECTION, collectionId };
}

export function parseAuthIntent(params: ProfileAuthIntentParams): AuthIntent | null {
  return (
    parseAddToCartIntent(params) ??
    parseFollowCreatorIntent(params) ??
    parseSaveCollectionIntent(params)
  );
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

export function buildFollowCreatorLoginHref(input: {
  creatorId: string;
  username?: string;
}): {
  pathname: '/(tabs)/profile';
  params: FollowCreatorAuthIntent;
} | null {
  const parsed = parseFollowCreatorIntent({
    intent: AUTH_INTENT_FOLLOW_CREATOR,
    creatorId: input.creatorId,
    username: input.username,
  });
  if (!parsed) return null;
  return {
    pathname: '/(tabs)/profile',
    params: parsed,
  };
}

export function buildSaveCollectionLoginHref(input: {
  collectionId: string;
}): {
  pathname: '/(tabs)/profile';
  params: SaveCollectionAuthIntent;
} | null {
  const parsed = parseSaveCollectionIntent({
    intent: AUTH_INTENT_SAVE_COLLECTION,
    collectionId: input.collectionId,
  });
  if (!parsed) return null;
  return {
    pathname: '/(tabs)/profile',
    params: parsed,
  };
}

/**
 * Profile destination after auth completes.
 * Forwards validated intent; otherwise plain Profile (no action).
 */
export function buildProfileHrefAfterAuth(params: ProfileAuthIntentParams): {
  pathname: '/(tabs)/profile';
  params?: AuthIntent;
} {
  const intent = parseAuthIntent(params);
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
 */
export function appendAuthIntentToRedirectUrl(
  redirectBaseUrl: string,
  intent: AuthIntent | null | undefined,
): string {
  const validated = intent ? parseAuthIntent(intent) : null;
  if (!validated) return redirectBaseUrl;

  const hashIndex = redirectBaseUrl.indexOf('#');
  const beforeHash = hashIndex >= 0 ? redirectBaseUrl.slice(0, hashIndex) : redirectBaseUrl;
  const hash = hashIndex >= 0 ? redirectBaseUrl.slice(hashIndex) : '';
  const sep = beforeHash.includes('?') ? '&' : '?';

  if (validated.intent === AUTH_INTENT_ADD_TO_CART) {
    return (
      `${beforeHash}${sep}` +
      `intent=${encodeURIComponent(validated.intent)}` +
      `&catalogProductId=${encodeURIComponent(validated.catalogProductId)}` +
      hash
    );
  }

  if (validated.intent === AUTH_INTENT_SAVE_COLLECTION) {
    return (
      `${beforeHash}${sep}` +
      `intent=${encodeURIComponent(validated.intent)}` +
      `&collectionId=${encodeURIComponent(validated.collectionId)}` +
      hash
    );
  }

  let url =
    `${beforeHash}${sep}` +
    `intent=${encodeURIComponent(validated.intent)}` +
    `&creatorId=${encodeURIComponent(validated.creatorId)}`;
  if (validated.username) {
    url += `&username=${encodeURIComponent(validated.username)}`;
  }
  return url + hash;
}
