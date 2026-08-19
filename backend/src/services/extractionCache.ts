import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCacheKey, getPipelineConfig } from '../config/pipelineConfig';
import type { ProductCandidate } from '../domain/types';

export type CachedExtractionPayload = {
  products: ProductCandidate[];
  finalStage: string;
  status: 'ready_for_review' | 'review_required';
  youtubeMetadata?: {
    title: string;
    description: string;
    descriptionSource: string;
    creator: string;
    thumbnailUrl: string | null;
  };
};

export async function getVideoExtractionCache(
  admin: SupabaseClient,
  params: { platform: string; externalVideoId: string },
): Promise<{ cacheKey: string; payload: CachedExtractionPayload } | null> {
  const cacheKey = buildCacheKey(params);
  const { data, error } = await admin
    .from('video_extraction_cache')
    .select('cache_key, payload')
    .eq('cache_key', cacheKey)
    .maybeSingle();
  if (error || !data?.payload) return null;
  return { cacheKey, payload: data.payload as CachedExtractionPayload };
}

export async function setVideoExtractionCache(
  admin: SupabaseClient,
  params: {
    platform: string;
    externalVideoId: string;
    products: ProductCandidate[];
    finalStage: string;
    status: 'ready_for_review' | 'review_required';
    youtubeMetadata?: CachedExtractionPayload['youtubeMetadata'];
  },
): Promise<string> {
  const cacheKey = buildCacheKey(params);
  const cfg = getPipelineConfig();
  await admin.from('video_extraction_cache').upsert(
    {
      cache_key: cacheKey,
      platform: params.platform,
      external_video_id: params.externalVideoId,
      pipeline_version: cfg.pipelineVersion,
      provider_version: cfg.providerVersion,
      payload: {
        products: params.products,
        finalStage: params.finalStage,
        status: params.status,
        youtubeMetadata: params.youtubeMetadata,
      },
      product_count: params.products.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'cache_key' },
  );
  return cacheKey;
}
