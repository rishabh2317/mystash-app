import type { SupabaseClient } from '@supabase/supabase-js';

type Attribution = { collectionId: string | null; tagId: string | null; creatorId: string | null; videoId: string | null };
/** Invalid/unverifiable attribution is discarded without preventing shopping navigation. */
export async function resolveRedirectAttribution(admin: SupabaseClient, input: {
  productId: string; collectionId: string | null; tagId: string | null; videoId: string | null; userId: string | null;
}): Promise<Attribution> {
  const empty: Attribution = { collectionId: null, tagId: null, creatorId: null, videoId: null };
  let collectionId = input.collectionId;
  let videoId: string | null = null;
  if (input.videoId) {
    const { data, error } = await admin.from('videos').select('id,collection_id').eq('id', input.videoId).maybeSingle();
    if (error || !data || !data.collection_id || (collectionId && collectionId !== data.collection_id)) return empty;
    collectionId = data.collection_id;
    videoId = data.id;
  }
  if (!collectionId) return empty;
  const { data: collection, error } = await admin.from('collections')
    .select('id,creator_id,status,visibility,moderation_state,deleted_at').eq('id', collectionId).maybeSingle();
  if (error || !collection || collection.deleted_at || collection.moderation_state !== 'clear') return empty;
  const visible = collection.creator_id === input.userId ||
    (collection.status === 'published' && ['public', 'unlisted'].includes(collection.visibility));
  if (!visible) return empty;
  let tags = admin.from('collection_product_tags').select('id').eq('collection_id', collectionId)
    .eq('catalog_product_id', input.productId);
  if (input.tagId) tags = tags.eq('id', input.tagId);
  const { data: tagRows, error: tagError } = await tags.limit(1);
  if (tagError || !tagRows?.length) return empty;
  return { collectionId, tagId: input.tagId, creatorId: collection.creator_id, videoId };
}
