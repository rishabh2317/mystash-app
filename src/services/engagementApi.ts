import { getOrCreateAnonymousId } from '@/src/services/anonymousId';
import { newEventId } from '@/src/services/newEventId';
import { supabase } from '@/src/services/supabase';

export class EngagementApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EngagementApiError';
  }
}

export type CreatorAnalyticsSummary = {
  totals: {
    views: number;
    followers: number;
    saves: number;
    shares: number;
    productRedirects: number;
  };
  collections: {
    collectionId: string;
    title: string | null;
    views: number;
    saves: number;
    shares: number;
    productRedirects: number;
  }[];
};

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new EngagementApiError('Mystash service is not configured.', 500);
  }
  return base;
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new EngagementApiError('Not authenticated', 401);
  }
  return token;
}

async function optionalBearerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await optionalBearerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function followCreator(creatorId: string, eventId?: string): Promise<void> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}/engagement/creators/${encodeURIComponent(creatorId)}/follow`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(eventId ? { event_id: eventId } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(body.error ?? `Follow failed (${res.status})`, res.status);
  }
}

export async function unfollowCreator(creatorId: string, eventId?: string): Promise<void> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}/engagement/creators/${encodeURIComponent(creatorId)}/follow`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(eventId ? { event_id: eventId } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(body.error ?? `Unfollow failed (${res.status})`, res.status);
  }
}

export async function isFollowingCreator(creatorId: string): Promise<boolean> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}/engagement/creators/${encodeURIComponent(creatorId)}/follow`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 401) return false;
  if (!res.ok) {
    // Fallback: list following
    return listFollowingIncludes(creatorId);
  }
  const body = (await res.json()) as { following?: boolean };
  return Boolean(body.following);
}

export async function listFollowingIncludes(creatorId: string): Promise<boolean> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}/engagement/me/following`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(body.error ?? `Following list failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as { following?: { creator_id: string }[] };
  return (body.following ?? []).some((e) => e.creator_id === creatorId);
}

export async function saveCollection(
  collectionId: string,
  opts?: { eventId?: string; creatorId?: string | null },
): Promise<void> {
  const token = await bearerToken();
  const res = await fetch(
    `${apiBase()}/engagement/collections/${encodeURIComponent(collectionId)}/save`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...(opts?.eventId ? { event_id: opts.eventId } : {}),
        ...(opts?.creatorId ? { creator_id: opts.creatorId } : {}),
      }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(body.error ?? `Save failed (${res.status})`, res.status);
  }
}

export async function unsaveCollection(collectionId: string, eventId?: string): Promise<void> {
  const token = await bearerToken();
  const res = await fetch(
    `${apiBase()}/engagement/collections/${encodeURIComponent(collectionId)}/save`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(eventId ? { event_id: eventId } : {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(body.error ?? `Unsave failed (${res.status})`, res.status);
  }
}

export async function listSavedCollectionIds(): Promise<string[]> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}/engagement/me/saves`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(body.error ?? `Saves list failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as { saves?: { collection_id: string }[] };
  return (body.saves ?? []).map((e) => e.collection_id);
}

/** Hydrate Save state from Engagement SoT (`GET /engagement/me/saves`). */
export async function isCollectionSaved(collectionId: string): Promise<boolean> {
  const ids = await listSavedCollectionIds();
  return ids.includes(collectionId);
}

export async function recordCollectionView(input: {
  collectionId: string;
  creatorId?: string | null;
  surface?: string | null;
  eventId?: string;
}): Promise<void> {
  const token = await optionalBearerToken();
  const body: Record<string, string> = {
    event_id: input.eventId ?? newEventId(),
  };
  if (input.creatorId) body.creator_id = input.creatorId;
  if (input.surface) body.surface = input.surface;
  if (!token) body.anonymous_id = await getOrCreateAnonymousId();

  const res = await fetch(
    `${apiBase()}/engagement/collections/${encodeURIComponent(input.collectionId)}/view`,
    {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(errBody.error ?? `View failed (${res.status})`, res.status);
  }
}

export async function recordCollectionShare(input: {
  collectionId: string;
  creatorId?: string | null;
  surface?: string | null;
  eventId?: string;
}): Promise<void> {
  const token = await optionalBearerToken();
  const body: Record<string, string> = {
    event_id: input.eventId ?? newEventId(),
  };
  if (input.creatorId) body.creator_id = input.creatorId;
  if (input.surface) body.surface = input.surface;
  if (!token) body.anonymous_id = await getOrCreateAnonymousId();

  const res = await fetch(
    `${apiBase()}/engagement/collections/${encodeURIComponent(input.collectionId)}/share`,
    {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(errBody.error ?? `Share failed (${res.status})`, res.status);
  }
}

export async function recordCreatorShare(input: {
  creatorId: string;
  surface?: string | null;
  eventId?: string;
}): Promise<void> {
  const token = await optionalBearerToken();
  const body: Record<string, string> = {
    event_id: input.eventId ?? newEventId(),
  };
  if (input.surface) body.surface = input.surface;
  if (!token) body.anonymous_id = await getOrCreateAnonymousId();

  const res = await fetch(
    `${apiBase()}/engagement/creators/${encodeURIComponent(input.creatorId)}/share`,
    {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(
      errBody.error ?? `Creator share failed (${res.status})`,
      res.status,
    );
  }
}

/** Creator analytics from Engagement denorm mirrors (`GET /engagement/me/analytics`). */
export async function getMyCreatorAnalytics(): Promise<CreatorAnalyticsSummary> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}/engagement/me/analytics`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new EngagementApiError(
      errBody.error ?? `Analytics failed (${res.status})`,
      res.status,
    );
  }
  const body = (await res.json()) as {
    totals?: {
      views?: number;
      followers?: number;
      saves?: number;
      shares?: number;
      product_redirects?: number;
    };
    collections?: {
      collection_id?: string;
      title?: string | null;
      views?: number;
      saves?: number;
      shares?: number;
      product_redirects?: number;
    }[];
  };
  return {
    totals: {
      views: Number(body.totals?.views) || 0,
      followers: Number(body.totals?.followers) || 0,
      saves: Number(body.totals?.saves) || 0,
      shares: Number(body.totals?.shares) || 0,
      productRedirects: Number(body.totals?.product_redirects) || 0,
    },
    collections: (body.collections ?? []).map((c) => ({
      collectionId: String(c.collection_id ?? ''),
      title: c.title ?? null,
      views: Number(c.views) || 0,
      saves: Number(c.saves) || 0,
      shares: Number(c.shares) || 0,
      productRedirects: Number(c.product_redirects) || 0,
    })),
  };
}
