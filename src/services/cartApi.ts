import { supabase } from '@/src/services/supabase';
import type { CatalogProductViewModel, CatalogVerificationStatus } from '@/src/types/catalogProduct';

export type CartItemAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'NO_DESTINATION';

export type CartItemSource = {
  collectionId?: string | null;
  creatorId?: string | null;
  collectionProductTagId?: string | null;
  surface?: 'COLLECTION' | 'SEARCH' | 'PRODUCT_DETAILS' | 'OTHER' | null;
};

export type CartLine = {
  cartItemId: string;
  catalogProductId: string;
  addedAt: string;
  availability: CartItemAvailability;
  product: CatalogProductViewModel | null;
  source: CartItemSource | null;
};

export type CartSnapshot = {
  items: CartLine[];
  itemCount: number;
};

export type RemoveCartItemReason = 'user_remove' | 'purchase_confirmed';

export class CartApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CartApiError';
  }
}

function cartApiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new CartApiError('Mystash cart service is not configured.', 500);
  }
  return base;
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new CartApiError('Not authenticated', 401);
  }
  return token;
}

function asVerification(value: unknown): CatalogVerificationStatus {
  if (value === 'VERIFIED' || value === 'UNVERIFIED' || value === 'UNRESOLVED') return value;
  return 'UNRESOLVED';
}

function asAvailability(value: unknown): CartItemAvailability {
  if (value === 'AVAILABLE' || value === 'UNAVAILABLE' || value === 'NO_DESTINATION') return value;
  return 'UNAVAILABLE';
}

function mapProduct(raw: unknown, fallbackCatalogId: string): CatalogProductViewModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id : fallbackCatalogId;
  const catalogProductId =
    typeof p.catalogProductId === 'string' ? p.catalogProductId : fallbackCatalogId;
  const title = typeof p.title === 'string' ? p.title : 'Product';
  return {
    id,
    catalogProductId,
    title,
    brand: typeof p.brand === 'string' ? p.brand : null,
    merchant: typeof p.merchant === 'string' ? p.merchant : null,
    heroImage: typeof p.heroImage === 'string' ? p.heroImage : null,
    galleryImages: Array.isArray(p.galleryImages)
      ? p.galleryImages.filter((u): u is string => typeof u === 'string')
      : [],
    description: typeof p.description === 'string' ? p.description : null,
    shortDescription: typeof p.shortDescription === 'string' ? p.shortDescription : null,
    specifications:
      p.specifications && typeof p.specifications === 'object' && !Array.isArray(p.specifications)
        ? Object.fromEntries(
            Object.entries(p.specifications as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
    verificationStatus: asVerification(p.verificationStatus),
    availability: typeof p.availability === 'string' ? p.availability : null,
    price: typeof p.price === 'string' ? p.price : null,
    currency: typeof p.currency === 'string' ? p.currency : null,
    lastVerifiedAt: typeof p.lastVerifiedAt === 'string' ? p.lastVerifiedAt : null,
    metadataCompleteness:
      typeof p.metadataCompleteness === 'number' ? p.metadataCompleteness : null,
  };
}

function mapSource(raw: unknown): CartItemSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const source: CartItemSource = {
    collectionId: typeof s.collectionId === 'string' ? s.collectionId : null,
    creatorId: typeof s.creatorId === 'string' ? s.creatorId : null,
    collectionProductTagId:
      typeof s.collectionProductTagId === 'string' ? s.collectionProductTagId : null,
    surface:
      s.surface === 'COLLECTION' ||
      s.surface === 'SEARCH' ||
      s.surface === 'PRODUCT_DETAILS' ||
      s.surface === 'OTHER'
        ? s.surface
        : null,
  };
  if (
    !source.collectionId &&
    !source.creatorId &&
    !source.collectionProductTagId &&
    !source.surface
  ) {
    return null;
  }
  return source;
}

function mapLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const catalogProductId =
    typeof item.catalogProductId === 'string' ? item.catalogProductId : null;
  const cartItemId = typeof item.cartItemId === 'string' ? item.cartItemId : null;
  if (!catalogProductId || !cartItemId) return null;
  return {
    cartItemId,
    catalogProductId,
    addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
    availability: asAvailability(item.availability),
    product: mapProduct(item.product, catalogProductId),
    source: mapSource(item.source),
  };
}

async function cartFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await bearerToken();
  return fetch(`${cartApiBase()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // ignore
  }
  return `Cart request failed (${res.status})`;
}

export async function fetchCart(): Promise<CartSnapshot> {
  const res = await cartFetch('/cart');
  if (!res.ok) throw new CartApiError(await readError(res), res.status);
  const body = (await res.json()) as { items?: unknown[]; itemCount?: number };
  const items = (body.items ?? []).map(mapLine).filter((x): x is CartLine => !!x);
  return {
    items,
    itemCount: typeof body.itemCount === 'number' ? body.itemCount : items.length,
  };
}

export async function addCartItem(
  catalogProductId: string,
  source?: CartItemSource | null,
): Promise<{ created: boolean; catalogProductId: string; cartItemId: string }> {
  const res = await cartFetch('/cart/items', {
    method: 'POST',
    body: JSON.stringify({
      catalogProductId,
      ...(source ? { source } : {}),
    }),
  });
  if (!res.ok) throw new CartApiError(await readError(res), res.status);
  const body = (await res.json()) as {
    created?: boolean;
    item?: { cartItemId?: string; catalogProductId?: string };
  };
  const id = body.item?.catalogProductId ?? catalogProductId;
  const cartItemId = body.item?.cartItemId;
  if (!cartItemId) throw new CartApiError('Cart add returned no item id', 500);
  return { created: Boolean(body.created), catalogProductId: id, cartItemId };
}

export async function removeCartItem(
  catalogProductId: string,
  reason: RemoveCartItemReason = 'user_remove',
): Promise<void> {
  const q = reason === 'purchase_confirmed' ? '?reason=purchase_confirmed' : '';
  const res = await cartFetch(`/cart/items/${encodeURIComponent(catalogProductId)}${q}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new CartApiError(await readError(res), res.status);
  }
}
