import type { SearchEntityType } from '@/src/services/searchApi';
import { dedupeById } from '@/src/mappers/searchMapper';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

export type SearchSections = { collections: CollectionViewModel[]; creators: CreatorViewModel[]; products: CatalogProductViewModel[] };
export type SearchTabState = { sections: SearchSections; loaded: boolean; loading: boolean; loadingMore: boolean; refreshing: boolean;
  error: string | null; zeroResult: boolean; nextCursor: string | null; intent: string | null };
export type SearchSession = { query: string; tabs: Record<SearchEntityType, SearchTabState> };
export const EMPTY_SECTIONS: SearchSections = { collections: [], creators: [], products: [] };

const emptyTab = (): SearchTabState => ({ sections: EMPTY_SECTIONS, loaded: false, loading: false, loadingMore: false,
  refreshing: false, error: null, zeroResult: false, nextCursor: null, intent: null });
export const emptySearchSession = (query = ''): SearchSession => ({ query,
  tabs: { collection: emptyTab(), creator: emptyTab(), product: emptyTab() } });

export function replaceSearchQuery(session: SearchSession, value: string): SearchSession {
  const query = value.trim();
  return query === session.query ? session : emptySearchSession(query);
}

export function mergeSearchSections(prev: SearchSections, next: SearchSections): SearchSections {
  return {
    collections: dedupeById([...prev.collections, ...next.collections], c => c.collectionId),
    creators: dedupeById([...prev.creators, ...next.creators], c => c.userId),
    products: dedupeById([...prev.products, ...next.products], p => p.id),
  };
}

export function searchResponseIsCurrent(session: SearchSession, input: string, query: string,
  epoch: number, currentEpoch: number, request: number, currentRequest: number): boolean {
  return session.query === query && input.trim() === query && epoch === currentEpoch && request === currentRequest;
}
