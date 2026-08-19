import type { Product, Video } from '@/src/mocks/videos';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import type { ReelProductChip, ReelViewModel } from '@/src/types/reel';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';

/** Map canonical Collection detail → shared Reel presentation model. */
export function mapCollectionDetailToReelViewModel(
  detail: CollectionDetailViewModel,
): ReelViewModel {
  const handleOrName =
    detail.creator.displayName?.trim() ||
    (detail.creator.username ? `@${detail.creator.username}` : 'Creator');

  const products: ReelProductChip[] = detail.products.map((p) => ({
    id: p.id,
    catalogProductId: p.catalogProductId,
    name: p.title,
    price: p.price?.trim() || '—',
    imageUrl: p.heroImage || CATALOG_IMAGE_PLACEHOLDER,
    provider: p.merchant,
  }));

  return {
    collectionId: detail.collectionId,
    title: detail.title ?? detail.primaryMedia?.title ?? null,
    heroThumbnailUrl: detail.heroThumbnailUrl ?? detail.primaryMedia?.thumbnailUrl ?? null,
    qualityScore: detail.qualityScore,
    creator: {
      id: detail.creator.id,
      handleOrName,
      username: detail.creator.username,
    },
    primaryMedia: {
      platform: detail.primaryMedia?.platform ?? 'unknown',
      sourceUrl: detail.primaryMedia?.sourceUrl ?? null,
      embedUrl: detail.primaryMedia?.embedUrl ?? null,
      thumbnailUrl:
        detail.primaryMedia?.thumbnailUrl ?? detail.heroThumbnailUrl ?? null,
    },
    products,
  };
}

/**
 * Adapt ReelViewModel to the existing ReelItem/BottomDock Video shape.
 * Preserves Home Reel stack; collection navigation uses collection_id only.
 */
export function mapReelViewModelToVideo(reel: ReelViewModel): Video {
  const products: Product[] = reel.products.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    image: p.imageUrl,
    provider: p.provider ?? undefined,
    catalog_product_id: p.catalogProductId ?? undefined,
  }));

  const sourceUrl = reel.primaryMedia.sourceUrl ?? reel.primaryMedia.embedUrl ?? '';

  return {
    // Distinct from collectionId — never treat this as a Collection ID.
    id: `reel-session:${reel.collectionId}`,
    url: sourceUrl,
    thumbnail: reel.primaryMedia.thumbnailUrl ?? reel.heroThumbnailUrl ?? '',
    creator_name: reel.creator.handleOrName,
    stash_score: reel.qualityScore ?? 0,
    product_name: products[0]?.name ?? reel.title ?? 'Collection',
    embed_url: reel.primaryMedia.embedUrl ?? undefined,
    video_title: reel.title ?? undefined,
    curator_id: reel.creator.username
      ? `@${reel.creator.username.replace(/^@/, '')}`
      : reel.creator.handleOrName,
    collection_id: reel.collectionId,
    products: products.length > 0 ? products : undefined,
  };
}
