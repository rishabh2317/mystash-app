import type { SupabaseClient } from '@supabase/supabase-js';

export type EligiblePublicReel = {
  reelId: string;
  collectionId: string;
  creatorId: string;
};

type Row = Record<string, unknown>;

/** Resolve videos.id only when its owning Collection is publicly eligible. */
export async function getEligiblePublicReel(
  admin: SupabaseClient,
  reelId: string,
): Promise<EligiblePublicReel | null> {
  const id = reelId.trim();
  if (!id) return null;

  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, collection_id')
    .eq('id', id)
    .maybeSingle();
  if (videoError || !video) return null;

  const collectionId = String((video as Row).collection_id ?? '');
  if (!collectionId) return null;
  const { data: collection, error: collectionError } = await admin
    .from('collections')
    .select('creator_id')
    .eq('id', collectionId)
    .eq('status', 'published')
    .eq('visibility', 'public')
    .eq('moderation_state', 'clear')
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .maybeSingle();
  if (collectionError || !collection) return null;

  const creatorId = String((collection as Row).creator_id ?? '');
  return creatorId ? { reelId: id, collectionId, creatorId } : null;
}

/** Aggregate active likes across eligible/public Reels in one database query. */
export async function sumCreatorPublicReelLikes(
  admin: SupabaseClient,
  creatorId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('sum_creator_public_reel_likes', {
    p_creator_id: creatorId,
  });
  if (error) throw new Error(error.message);
  return Math.max(0, Math.floor(Number(data) || 0));
}
