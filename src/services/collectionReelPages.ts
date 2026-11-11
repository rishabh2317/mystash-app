import type { CollectionReelSource, CollectionReelRef } from '../state/collectionReelSession';
import type { CollectionViewModel } from '../types/collection';
import type { SearchResultCard } from './searchApi';
import { collectionRefsFromSearchResults } from '../ui/searchReelNavigation';

type Page = { collections: CollectionReelRef[]; nextCursor: string | null };
/** Inject existing transports so pagination can be checked without provider calls. */
export function createCollectionReelPageLoader(api: {
  creator(id: string, options: {limit: number; cursor: string | null}): Promise<{collections: CollectionViewModel[]; nextCursor: string | null}>;
  saved(): Promise<string[]>;
  search(options: {q: string; entityType?: 'collection'; presentation: 'unified' | 'typed'; limit: number; cursor: string}): Promise<{results: SearchResultCard[]; nextCursor: string | null}>;
}) {
  return async (source: CollectionReelSource | {kind:'search'; query:string; entityType?:'collection'}, cursor: string): Promise<Page> => {
    if (source.kind === 'creator') {
      const page = await api.creator(source.creatorId, {limit:20,cursor:cursor || null});
      return {collections:page.collections,nextCursor:page.nextCursor};
    }
    if (source.kind === 'saved') return {collections:(await api.saved()).map(collectionId=>({collectionId})),nextCursor:null};
    if (source.kind === 'search') {
      const page = await api.search({q:source.query,entityType:source.entityType,presentation:source.entityType?'unified':'typed',limit:20,cursor});
      return {collections:collectionRefsFromSearchResults(page.results,[]),nextCursor:page.nextCursor};
    }
    return {collections:[],nextCursor:null};
  };
}
