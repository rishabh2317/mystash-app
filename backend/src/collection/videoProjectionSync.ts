import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { transformToEmbedUrl } from '../pipeline/embed';
import {
  assertIndependentVideoAndCollectionIds,
  buildVideoProductInserts,
  resolvePublishVideoId,
  type VideoProductInsertDraft,
} from '../publishVideoProjection';
import {
  isPublishSurfaceTag,
  type Collection,
  type ResolutionStatus,
  type TagStatus,
  type TagVisibility,
} from './domain/types';

function isPubliclyReadableCollection(collection: Collection): boolean {
  return (
    collection.status === 'published' &&
    collection.visibility === 'public' &&
    collection.moderationState === 'clear' &&
    !collection.deletedAt
  );
}

/**
 * Keep Home Feed projection aligned with Collection visibility lifecycle.
 * When a Collection stops being publicly readable, remove its feed video.
 */
export async function pruneVideoProjectionIfNotPublic(
  admin: SupabaseClient,
  collection: Collection,
): Promise<void> {
  if (isPubliclyReadableCollection(collection)) return;
  const { error } = await admin.from('videos').delete().eq('collection_id', collection.id);
  if (error) throw new Error(error.message);
}

export type FeedProjectionMedia = {
  canonicalUrl: string | null;
  sourceUrl: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
};

export type FeedVideoWrite = {
  url: string;
  thumbnail: string;
  creator_name: string;
  stash_score: number;
  product_name: string;
  embed_url: string | null;
  video_title: string;
  curator_id: string;
  collection_id: string;
};

export type FeedShelfTag = {
  catalogProductId: string | null;
  includeInPublish: boolean;
  deletedAt: string | null;
  tagStatus: TagStatus;
  visibility: TagVisibility;
  resolutionStatus: ResolutionStatus | null;
  nameSnapshot: string | null;
  imageSnapshot: string | null;
  merchantUrl: string | null;
  brandSnapshot: string | null;
  sortOrder: number;
};

/** Same `videos` row shape as ingest dual-write. No provider fetch. */
export function buildFeedVideoWrite(
  collection: Collection,
  media: FeedProjectionMedia | null,
): FeedVideoWrite | null {
  if (!isPubliclyReadableCollection(collection) || !collection.feedEligible) return null;
  const url = (media?.canonicalUrl || media?.sourceUrl || collection.originSourceUrl || '').trim();
  if (!url) return null;
  const thumbnail = (media?.thumbnailUrl || collection.heroThumbnailUrl || '').trim();
  const handle = (collection.creatorUsername || collection.creatorName || 'creator').replace(/^@/, '');
  const productName = (collection.primaryProductNameSnapshot || collection.title || 'Collection').trim();
  const embed =
    media?.embedUrl?.trim() ||
    transformToEmbedUrl(url, collection.originPlatform ?? undefined) ||
    null;
  return {
    url,
    thumbnail,
    creator_name: handle,
    stash_score: Number(collection.qualityScore) || 4.5,
    product_name: productName,
    embed_url: embed,
    video_title: (collection.title || media?.title || productName).trim(),
    curator_id: `@${handle}`,
    collection_id: collection.id,
  };
}

/** Shelf rows from tags already on the Collection. Skips discovered-only tags. */
export function feedShelfDrafts(tags: readonly FeedShelfTag[]): VideoProductInsertDraft[] {
  return [...tags]
    .filter(
      (tag) =>
        Boolean(tag.catalogProductId) &&
        isPublishSurfaceTag(tag) &&
        (tag.resolutionStatus === 'VERIFIED' || tag.resolutionStatus === 'UNVERIFIED'),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((tag, index) => ({
      name: tag.nameSnapshot?.trim() || 'Product',
      price: '—',
      image: tag.imageSnapshot?.trim() || 'https://picsum.photos/seed/vp/400/400',
      merchant_url: tag.merchantUrl,
      affiliate_url: null,
      provider: tag.brandSnapshot?.trim() || 'catalog',
      sort_order: index,
      catalog_product_id: tag.catalogProductId as string,
      resolution_status: tag.resolutionStatus as string,
    }));
}

type MediaRow = {
  canonical_url?: string | null;
  source_url?: string | null;
  embed_url?: string | null;
  thumbnail_url?: string | null;
  title?: string | null;
};

type TagRow = {
  catalog_product_id?: string | null;
  include_in_publish?: boolean | null;
  deleted_at?: string | null;
  tag_status?: string | null;
  visibility?: string | null;
  resolution_status?: string | null;
  name_snapshot?: string | null;
  image_snapshot?: string | null;
  merchant_url?: string | null;
  brand_snapshot?: string | null;
  sort_order?: number | null;
};

function mapShelfTag(row: TagRow): FeedShelfTag {
  const status = row.tag_status;
  const tagStatus: TagStatus =
    status === 'proposed' ||
    status === 'accepted' ||
    status === 'rejected' ||
    status === 'published' ||
    status === 'archived' ||
    status === 'deleted'
      ? status
      : 'accepted';
  const resolution = row.resolution_status;
  const resolutionStatus =
    resolution === 'VERIFIED' || resolution === 'UNVERIFIED' || resolution === 'UNRESOLVED'
      ? resolution
      : null;
  return {
    catalogProductId: row.catalog_product_id ?? null,
    includeInPublish: Boolean(row.include_in_publish),
    deletedAt: row.deleted_at ?? null,
    tagStatus,
    visibility: row.visibility === 'hidden' ? 'hidden' : 'visible',
    resolutionStatus,
    nameSnapshot: row.name_snapshot ?? null,
    imageSnapshot: row.image_snapshot ?? null,
    merchantUrl: row.merchant_url ?? null,
    brandSnapshot: row.brand_snapshot ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

/**
 * Upsert the existing `videos` projection when a Collection is public.
 * Prunes otherwise. Does not delete video_products that ingest already wrote.
 */
export async function syncHomeFeedProjection(
  admin: SupabaseClient,
  collection: Collection,
): Promise<'pruned' | 'upserted' | 'skipped'> {
  if (!isPubliclyReadableCollection(collection)) {
    await pruneVideoProjectionIfNotPublic(admin, collection);
    return 'pruned';
  }
  if (!collection.feedEligible) {
    const { error } = await admin.from('videos').delete().eq('collection_id', collection.id);
    if (error) throw new Error(error.message);
    return 'pruned';
  }

  const { data: mediaRows, error: mediaError } = await admin
    .from('collection_media')
    .select('canonical_url, source_url, embed_url, thumbnail_url, title')
    .eq('collection_id', collection.id)
    .eq('is_primary', true)
    .limit(1);
  if (mediaError) throw new Error(mediaError.message);
  const mediaRow = (Array.isArray(mediaRows) ? mediaRows[0] : null) as MediaRow | null;
  const write = buildFeedVideoWrite(
    collection,
    mediaRow
      ? {
          canonicalUrl: mediaRow.canonical_url ?? null,
          sourceUrl: mediaRow.source_url ?? null,
          embedUrl: mediaRow.embed_url ?? null,
          thumbnailUrl: mediaRow.thumbnail_url ?? null,
          title: mediaRow.title ?? null,
        }
      : null,
  );
  if (!write) return 'skipped';

  const { data: existing, error: existingError } = await admin
    .from('videos')
    .select('id')
    .eq('collection_id', collection.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const { videoId, shouldInsertVideo } = resolvePublishVideoId({
    existingVideoId: (existing as { id?: string } | null)?.id ?? null,
    newVideoId: randomUUID(),
  });
  assertIndependentVideoAndCollectionIds(videoId, collection.id);

  if (shouldInsertVideo) {
    const { error } = await admin.from('videos').insert({ id: videoId, ...write });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from('videos').update(write).eq('id', videoId);
    if (error) throw new Error(error.message);
  }

  const { data: existingProducts, error: productReadError } = await admin
    .from('video_products')
    .select('id')
    .eq('video_id', videoId)
    .limit(1);
  if (productReadError) throw new Error(productReadError.message);
  if (Array.isArray(existingProducts) && existingProducts.length > 0) return 'upserted';

  const { data: tagRows, error: tagError } = await admin
    .from('collection_product_tags')
    .select(
      'catalog_product_id, include_in_publish, deleted_at, tag_status, visibility, resolution_status, name_snapshot, image_snapshot, merchant_url, brand_snapshot, sort_order',
    )
    .eq('collection_id', collection.id);
  if (tagError) throw new Error(tagError.message);
  const drafts = feedShelfDrafts(((tagRows ?? []) as TagRow[]).map(mapShelfTag));
  if (drafts.length === 0) return 'upserted';
  const { error: insertError } = await admin
    .from('video_products')
    .insert(buildVideoProductInserts(videoId, drafts));
  if (insertError) throw new Error(insertError.message);
  return 'upserted';
}
