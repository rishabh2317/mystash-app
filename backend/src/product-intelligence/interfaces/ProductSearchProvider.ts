import type { SearchCandidate, SearchResult } from '../domain/types';

export type ProductSearchProvider = {
  readonly name: string;
  search(query: string): Promise<SearchResult>;
};

export type SearchStrategy = {
  search(query: string): Promise<SearchResult>;
};

export type { SearchCandidate, SearchResult };
