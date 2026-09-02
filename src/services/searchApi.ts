import { getOrCreateAnonymousId } from '@/src/services/anonymousId';
import { supabase } from '@/src/services/supabase';

export class SearchApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SearchApiError';
  }
}

export type SearchEntityType = 'collection' | 'creator' | 'product';

export type SearchCreatorSnapshot = {
  creatorId: string;
  displayName: string | null;
  username: string | null;
  avatarRef: string | null;
};

export type SearchResultCard = {
  entityType: SearchEntityType;
  id: string;
  score: number;
  title: string;
  subtitle: string | null;
  imageRef: string | null;
  slug?: string | null;
  primaryMediaRef?: string | null;
  creator?: SearchCreatorSnapshot | null;
  productTagCount?: number;
  viewsCount?: number;
  savesCount?: number;
  username?: string | null;
  followersCount?: number;
  verificationStatus?: string | null;
  price?: string | null;
  priceCurrency?: string | null;
  matchReason?: string | null;
};

export type SearchQueryIntent =
  | 'EXACT_PRODUCT'
  | 'CREATOR'
  | 'DISCOVERY'
  | 'CATEGORY_CONCEPT'
  | 'COMPARISON'
  | 'COMMERCE'
  | 'TRENDING';

export type BlendedSearchResponse = {
  query: string;
  intent: SearchQueryIntent | string;
  retrievalMode: string;
  presentation: 'unified' | 'typed';
  results: SearchResultCard[];
  lanes?: {
    collections: SearchResultCard[];
    creators: SearchResultCard[];
    products: SearchResultCard[];
  };
  nextCursor: string | null;
  zeroResult: boolean;
  latencyMs: number;
  degraded?: string[];
};

export type AutocompleteSuggestion = {
  kind: 'collection' | 'creator' | 'product' | 'recent' | 'trending';
  text: string;
  id?: string;
  entityType?: SearchEntityType;
};

export type AutocompleteResponse = {
  query: string;
  suggestions: AutocompleteSuggestion[];
};

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new SearchApiError('Mystash service is not configured.', 500);
  }
  return base;
}

async function optionalBearerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await optionalBearerToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function parseCard(raw: Record<string, unknown>): SearchResultCard | null {
  const entityType = raw.entityType;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (
    (entityType !== 'collection' && entityType !== 'creator' && entityType !== 'product') ||
    !id
  ) {
    return null;
  }
  const creatorRaw = raw.creator;
  let creator: SearchCreatorSnapshot | null = null;
  if (creatorRaw && typeof creatorRaw === 'object' && !Array.isArray(creatorRaw)) {
    const c = creatorRaw as Record<string, unknown>;
    const creatorId = typeof c.creatorId === 'string' ? c.creatorId : '';
    if (creatorId) {
      creator = {
        creatorId,
        displayName: typeof c.displayName === 'string' ? c.displayName : null,
        username: typeof c.username === 'string' ? c.username : null,
        avatarRef: typeof c.avatarRef === 'string' ? c.avatarRef : null,
      };
    }
  }
  return {
    entityType,
    id,
    score: typeof raw.score === 'number' ? raw.score : 0,
    title: typeof raw.title === 'string' ? raw.title : id,
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : null,
    imageRef: typeof raw.imageRef === 'string' ? raw.imageRef : null,
    slug: typeof raw.slug === 'string' ? raw.slug : null,
    primaryMediaRef: typeof raw.primaryMediaRef === 'string' ? raw.primaryMediaRef : null,
    creator,
    productTagCount: typeof raw.productTagCount === 'number' ? raw.productTagCount : undefined,
    viewsCount: typeof raw.viewsCount === 'number' ? raw.viewsCount : undefined,
    savesCount: typeof raw.savesCount === 'number' ? raw.savesCount : undefined,
    username: typeof raw.username === 'string' ? raw.username : null,
    followersCount: typeof raw.followersCount === 'number' ? raw.followersCount : undefined,
    verificationStatus:
      typeof raw.verificationStatus === 'string' ? raw.verificationStatus : null,
    price: typeof raw.price === 'string' ? raw.price : null,
    priceCurrency: typeof raw.priceCurrency === 'string' ? raw.priceCurrency : null,
    matchReason: typeof raw.matchReason === 'string' ? raw.matchReason : null,
  };
}

function parseCards(raw: unknown): SearchResultCard[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchResultCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const card = parseCard(item as Record<string, unknown>);
    if (card) out.push(card);
  }
  return out;
}

export async function searchBlended(input: {
  q: string;
  presentation?: 'unified' | 'typed';
  limit?: number;
  cursor?: string | null;
}): Promise<BlendedSearchResponse> {
  const q = input.q.trim();
  if (!q) {
    throw new SearchApiError('q required', 400);
  }
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('presentation', input.presentation ?? 'typed');
  if (input.limit != null) params.set('limit', String(input.limit));
  if (input.cursor) params.set('cursor', input.cursor);

  const res = await fetch(`${apiBase()}/search?${params.toString()}`, {
    method: 'GET',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new SearchApiError(body.error ?? `Search failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const lanesRaw =
    body.lanes && typeof body.lanes === 'object' && !Array.isArray(body.lanes)
      ? (body.lanes as Record<string, unknown>)
      : null;

  return {
    query: typeof body.query === 'string' ? body.query : q,
    intent: typeof body.intent === 'string' ? body.intent : '',
    retrievalMode: typeof body.retrievalMode === 'string' ? body.retrievalMode : '',
    presentation: body.presentation === 'unified' ? 'unified' : 'typed',
    results: parseCards(body.results),
    lanes: lanesRaw
      ? {
          collections: parseCards(lanesRaw.collections),
          creators: parseCards(lanesRaw.creators),
          products: parseCards(lanesRaw.products),
        }
      : undefined,
    nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
    zeroResult: Boolean(body.zeroResult),
    latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : 0,
    degraded: Array.isArray(body.degraded)
      ? body.degraded.filter((d): d is string => typeof d === 'string')
      : undefined,
  };
}

export async function searchAutocomplete(input: {
  q: string;
  limit?: number;
}): Promise<AutocompleteResponse> {
  const q = input.q.trim();
  if (!q) {
    return { query: '', suggestions: [] };
  }
  const params = new URLSearchParams();
  params.set('q', q);
  if (input.limit != null) params.set('limit', String(input.limit));

  const res = await fetch(`${apiBase()}/search/autocomplete?${params.toString()}`, {
    method: 'GET',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new SearchApiError(body.error ?? `Autocomplete failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as {
    query?: string;
    suggestions?: {
      kind?: string;
      text?: string;
      id?: string;
      entityType?: SearchEntityType;
    }[];
  };
  const suggestions: AutocompleteSuggestion[] = [];
  for (const s of body.suggestions ?? []) {
    if (!s.text?.trim()) continue;
    const kind = s.kind;
    if (
      kind !== 'collection' &&
      kind !== 'creator' &&
      kind !== 'product' &&
      kind !== 'recent' &&
      kind !== 'trending'
    ) {
      continue;
    }
    suggestions.push({
      kind,
      text: s.text.trim(),
      id: typeof s.id === 'string' ? s.id : undefined,
      entityType: s.entityType,
    });
  }
  return { query: body.query ?? q, suggestions };
}

/** Search-owned CTR — not Engagement. Failures must not block navigation. */
export async function recordSearchClick(input: {
  query: string;
  clickedId: string;
  clickedEntityType: SearchEntityType;
}): Promise<void> {
  const query = input.query.trim();
  if (!query || !input.clickedId.trim()) return;
  const token = await optionalBearerToken();
  const body: Record<string, string> = {
    query,
    clicked_id: input.clickedId.trim(),
    clicked_entity_type: input.clickedEntityType,
  };
  if (!token) {
    try {
      body.anonymous_id = await getOrCreateAnonymousId();
    } catch {
      /* optional */
    }
  }
  const res = await fetch(`${apiBase()}/search/telemetry/click`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new SearchApiError(errBody.error ?? `Click telemetry failed (${res.status})`, res.status);
  }
}
