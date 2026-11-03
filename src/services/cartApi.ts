import { supabase } from '@/src/services/supabase';
import { withRequestTimeout } from './requestTimeout';
import {
  hydrateCartLines,
  type CartItemSource,
  type CartLine,
} from '@/src/services/cartLineMap';

export type {
  CartItemAvailability,
  CartItemSource,
  CartLine,
} from '@/src/services/cartLineMap';
export { hydrateCartLines } from '@/src/services/cartLineMap';

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

async function bearerToken(expectedOwner?: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || (expectedOwner && data.session?.user.id !== expectedOwner)) {
    throw new CartApiError('Not authenticated', 401);
  }
  return token;
}

async function cartFetch(path: string, init?: RequestInit, expectedOwner?: string): Promise<Response> {
  const token = await bearerToken(expectedOwner);
  const response = await fetch(`${cartApiBase()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (expectedOwner) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== expectedOwner) throw new CartApiError('Your account changed. Refresh My Stash.',401);
  }
  return response;
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

export async function fetchCart(expectedOwner?: string): Promise<CartSnapshot> {
  const res = await withRequestTimeout(20_000, signal => cartFetch('/cart', { signal }, expectedOwner));
  if (!res.ok) throw new CartApiError(await readError(res), res.status);
  const body = (await res.json()) as { items?: unknown[]; itemCount?: number };
  const items = hydrateCartLines(body.items ?? []);
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
