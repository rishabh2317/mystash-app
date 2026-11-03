import { supabase } from '@/src/services/supabase';
import type { PlaceStashPage } from '@/src/types/placeStash';
import { collectStashPages } from '@/src/services/stashPageCollection';
import { hydratePlaceStashPage } from '@/src/ui/stashPlaces';

export class PlacesApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PlacesApiError';
  }
}

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new PlacesApiError('Mystash service is not configured.', 500);
  }
  return base;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new PlacesApiError('Not authenticated', 401);
  }

  return token;
}

async function readPlaces(token: string, page?: { limit: number; cursor?: string }): Promise<PlaceStashPage> {
  const params = page ? `?${new URLSearchParams({ limit: String(page.limit), ...(page.cursor ? { cursor: page.cursor } : {}) })}` : '';
  const res = await fetch(`${apiBase()}/places${params}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new PlacesApiError(body.error ?? `Places failed (${res.status})`, res.status);
  }

  return hydratePlaceStashPage(await res.json());
}


export async function fetchPlaces(page?: { limit: number; cursor?: string }): Promise<PlaceStashPage> {
  return readPlaces(await accessToken(), page);
}

export async function fetchAllPlaces(isCurrent?: () => boolean): Promise<PlaceStashPage> {
  // Pin this request to one authenticated account while cursor pages are read.
  const token = await accessToken();
  let count = 0;
  const items = await collectStashPages(async cursor => {
    const page = await readPlaces(token, cursor ? { limit: 100, cursor } : undefined);
    count = page.itemCount;
    return page;
  }, item => item.saveId ? `save:${item.saveId}` : `${item.kind}:${item.id}`, isCurrent);
  return { items, itemCount: Math.max(count, items.length), nextCursor: null };
}
