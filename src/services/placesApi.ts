import { supabase } from '@/src/services/supabase';
import type { PlaceStashPage } from '@/src/types/placeStash';
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

export async function fetchPlaces(): Promise<PlaceStashPage> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new PlacesApiError('Not authenticated', 401);
  }

  const res = await fetch(`${apiBase()}/places`, {
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
