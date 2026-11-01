import type { SupabaseClient } from '@supabase/supabase-js';

/** Serialize mutations for one draft in this API process, including legacy drafts
 * without a collection link. Keep the slot until work settles, never just until
 * the client disconnects. The publication lease supplies cross-replica fencing. */
export function createPublishGuard() {
  const active = new Set<string>();
  return (key: string): (() => void) | null => {
    if (active.has(key) || active.size >= 256) return null;
    active.add(key);
    let released = false;
    return () => { if (!released) { released = true; active.delete(key); } };
  };
}

export function finalizedPublishResponse(ingest: {
  status: string; collection_id?: string | null; video_id?: string | null;
}, rejectAll: boolean) {
  if (ingest.status === 'published') return { status: 200, body: {
    ok: true, videoId: ingest.video_id ?? null, collectionId: ingest.collection_id ?? null, message: 'Already finalized',
  } };
  if (ingest.status === 'rejected') return rejectAll
    ? { status: 200, body: { ok: true, message: 'Already finalized' } }
    : { status: 409, body: { error: 'This draft was discarded and cannot be published.' } };
  return null;
}

/** Verify the durable ingest identity instead of trusting a helper's returned ID
 * or the existing-link value from an earlier snapshot. */
export async function assertPersistedCollectionLink(admin: SupabaseClient, ingestId: string, collectionId: string) {
  const { data, error } = await admin.from('ingest_requests').select('collection_id').eq('id', ingestId).maybeSingle();
  if (error || data?.collection_id !== collectionId) throw new Error('Collection preparation was not saved. Retry this draft before publishing.');
}

/** Resume a partially finalized publication without republishing its Collection,
 * changing its selected tags, or emitting another CollectionPublished event. */
export async function publishCollectionOnce<T extends { status: string }>(selected: string[], ports: {
  read: () => Promise<{ collection: T; selected: string[] } | null>;
  sync: () => Promise<void>; publish: () => Promise<T>;
}): Promise<T> {
  const existing = await ports.read();
  if (existing?.collection.status === 'published') {
    const same = (a: string[]) => [...new Set(a)].sort().join('\n');
    if (same(existing.selected) !== same(selected)) throw Object.assign(
      new Error('This Collection is already published. Reopen it to edit products.'), { statusCode: 409 });
    return existing.collection;
  }
  await ports.sync();
  return ports.publish();
}

export function assertPublishCollectionAccess(collection: { creatorId: string; deletedAt: string | null; moderationState: string }, userId: string) {
  if (collection.creatorId !== userId || collection.deletedAt) throw Object.assign(new Error('Collection not found'), { statusCode: 404 });
  if (collection.moderationState === 'takedown' || collection.moderationState === 'rejected') {
    throw Object.assign(new Error('Collection cannot be published under moderation hold'), { statusCode: 400 });
  }
}

export type PublicationProjectionResult = {
  videoId: string;
  collectionId: string;
  products: { id: string; catalog_product_id: string | null; resolution_status: string | null; sort_order: number }[];
};

/** The server chooses/reuses the video identity and commits its projection and
 * final draft status together. A rejected RPC leaves the previous projection intact. */
export async function finalizePublication(admin: SupabaseClient, ingestId: string, collectionId: string,
  video: Record<string, unknown>, products: Record<string, unknown>[]): Promise<PublicationProjectionResult> {
  const { data, error } = await admin.rpc('publication_finalize', {
    p_ingest_id: ingestId, p_collection_id: collectionId, p_video: video, p_products: products,
  });
  if (error) throw Object.assign(new Error('Publication could not be finalized. Your draft is retained; retry this same draft.'), {
    statusCode: error.code === '55000' || error.code === '55P03' ? 409 : 500,
  });
  if (!data?.videoId || data.collectionId !== collectionId || !Array.isArray(data.products)) {
    throw new Error('Publication was not confirmed. Retry this same draft.');
  }
  return data as PublicationProjectionResult;
}
