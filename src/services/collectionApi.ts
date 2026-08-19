import { mapPublishedCollectionListItem } from '@/src/mappers/collectionMapper';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CollectionAggregateDto } from '@/src/types/collectionAggregate';

export class CollectionApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CollectionApiError';
  }
}

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new CollectionApiError('Mystash service is not configured.', 500);
  }
  return base;
}

export type CreatorCollectionsPage = {
  collections: CollectionViewModel[];
  nextCursor: string | null;
};

/** Public published Collections for a creator (Creator Profile grid). */
export async function listCreatorCollections(
  creatorId: string,
  opts?: { limit?: number; cursor?: string | null },
): Promise<CreatorCollectionsPage> {
  const params = new URLSearchParams();
  params.set('creator_id', creatorId);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);

  const res = await fetch(`${apiBase()}/collections?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new CollectionApiError(body.error ?? `Collections failed (${res.status})`, res.status);
  }

  const body = (await res.json()) as {
    collections?: Parameters<typeof mapPublishedCollectionListItem>[0][];
    nextCursor?: string | null;
  };

  return {
    collections: (body.collections ?? []).map(mapPublishedCollectionListItem),
    nextCursor: body.nextCursor ?? null,
  };
}

/** Public Collection aggregate by id (Collection page + Reel hydration). */
export async function fetchCollectionById(collectionId: string): Promise<CollectionAggregateDto> {
  const id = collectionId.trim();
  if (!id) {
    throw new CollectionApiError('Collection id is required', 400);
  }

  const res = await fetch(`${apiBase()}/collections/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) {
    throw new CollectionApiError('Collection not found', 404);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new CollectionApiError(body.error ?? `Collection failed (${res.status})`, res.status);
  }

  const body = (await res.json()) as CollectionAggregateDto;
  if (!body?.collection?.id) {
    throw new CollectionApiError('Invalid collection response', 500);
  }
  return {
    collection: body.collection,
    media: body.media ?? [],
    tags: body.tags ?? [],
  };
}
