import { mapAggregateToCollectionViewModel } from '@/src/mappers/collectionMapper';
import { fetchCollectionById } from '@/src/services/collectionApi';
import { listSavedCollectionIds } from '@/src/services/engagementApi';
import type { CollectionViewModel } from '@/src/types/collection';

const SAVED_HYDRATE_LIMIT = 20;

export type SavedCollectionsPage = {
  items: CollectionViewModel[];
  /** Edge count from Engagement — not invented client-side. */
  total: number;
};

/** Resolve saved collection ids to existing Collection rows. Skips missing ids. */
export async function loadSavedCollections(): Promise<SavedCollectionsPage> {
  const ids = await listSavedCollectionIds();
  const items: CollectionViewModel[] = [];
  for (const id of ids.slice(0, SAVED_HYDRATE_LIMIT)) {
    try {
      const aggregate = await fetchCollectionById(id);
      items.push(mapAggregateToCollectionViewModel(aggregate));
    } catch {
      // Collection may have been unpublished after the save edge was written.
    }
  }
  return { items, total: ids.length };
}
