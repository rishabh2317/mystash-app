import { catalogRowToViewModel, tagSnapshotToViewModel } from '@/src/services/catalogProductMapper';
import type { CatalogProductRow } from '@/src/types/catalogProduct';
import type { CollectionAggregateDto, CollectionAggregateTagDto } from '@/src/types/collectionAggregate';
import type {
  CollectionDetailViewModel,
  CollectionMediaPlatform,
  CollectionMediaViewModel,
} from '@/src/types/collectionDetail';
import { detectPlatform, transformToEmbedUrl } from '@/src/utils/videoUtils';

/** Mirror backend isPublishSurfaceTag — publish-surface product rows only. */
export function isPublishSurfaceTag(
  tag: Pick<
    CollectionAggregateTagDto,
    'visibility' | 'includeInPublish' | 'tagStatus' | 'deletedAt'
  >,
): boolean {
  if (tag.deletedAt) return false;
  if (tag.tagStatus === 'deleted' || tag.tagStatus === 'rejected' || tag.tagStatus === 'archived') {
    return false;
  }
  return tag.visibility === 'visible' && tag.includeInPublish;
}

function resolveMediaPlatform(
  originPlatform: string | null,
  sourceUrl: string | null,
  sourceProvider: string | null,
): CollectionMediaPlatform {
  const fromUrl = sourceUrl ? detectPlatform(sourceUrl) : null;
  if (fromUrl === 'youtube' || fromUrl === 'instagram') return fromUrl;
  const p = (originPlatform ?? sourceProvider ?? '').toLowerCase();
  if (p.includes('youtube')) return 'youtube';
  if (p.includes('instagram')) return 'instagram';
  return 'unknown';
}

export function mapPrimaryMedia(
  aggregate: CollectionAggregateDto,
): CollectionMediaViewModel | null {
  const { collection, media } = aggregate;
  const primary = media.find((m) => m.isPrimary) ?? media[0];
  if (!primary && !collection.heroThumbnailUrl && !collection.originPlatform) {
    return null;
  }

  const sourceUrl = primary?.sourceUrl ?? null;
  const embedUrl =
    primary?.embedUrl ??
    (sourceUrl ? transformToEmbedUrl(sourceUrl) : null) ??
    null;

  return {
    platform: resolveMediaPlatform(
      collection.originPlatform,
      sourceUrl,
      primary?.sourceProvider ?? null,
    ),
    sourceUrl,
    embedUrl,
    thumbnailUrl: primary?.thumbnailUrl ?? collection.heroThumbnailUrl ?? null,
    title: primary?.title ?? collection.title,
  };
}

export function mapAggregateToCollectionDetail(
  aggregate: CollectionAggregateDto,
  catalogById: Map<string, CatalogProductRow>,
): CollectionDetailViewModel {
  const { collection } = aggregate;
  const surfaceTags = aggregate.tags
    .filter(isPublishSurfaceTag)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const products = surfaceTags.map((tag) => {
    const catId = tag.catalogProductId?.trim();
    if (catId && catalogById.has(catId)) {
      return catalogRowToViewModel(catalogById.get(catId)!);
    }
    return tagSnapshotToViewModel(tag);
  });

  return {
    collectionId: collection.id,
    slug: collection.slug,
    title: collection.title,
    caption: collection.caption,
    heroThumbnailUrl: collection.heroThumbnailUrl,
    qualityScore: collection.qualityScore,
    publishedAt: collection.publishedAt,
    creator: {
      id: collection.creatorId,
      username: collection.creatorUsername,
      displayName: collection.creatorName,
      avatarUrl: collection.creatorAvatar,
    },
    counters: {
      views: collection.viewsCount ?? 0,
      saves: collection.savesCount ?? 0,
    },
    primaryMedia: mapPrimaryMedia(aggregate),
    products,
  };
}
