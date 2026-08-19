import {
  isPublishSurfaceTag,
  mapAggregateToCollectionDetail,
} from '@/src/mappers/collectionDetailMapper';
import { fetchCollectionById } from '@/src/services/collectionApi';
import { fetchCatalogProductsByIds } from '@/src/services/supabase';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';

/** Load canonical Collection detail: aggregate + catalog hydration. */
export async function loadCollectionDetail(
  collectionId: string,
): Promise<CollectionDetailViewModel> {
  const aggregate = await fetchCollectionById(collectionId);
  const catalogIds = aggregate.tags
    .filter(isPublishSurfaceTag)
    .map((t) => t.catalogProductId)
    .filter((id): id is string => !!id?.trim());
  const catalogById = await fetchCatalogProductsByIds(catalogIds);
  return mapAggregateToCollectionDetail(aggregate, catalogById);
}
