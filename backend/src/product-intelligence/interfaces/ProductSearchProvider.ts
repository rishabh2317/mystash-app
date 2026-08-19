import type { SearchCandidate, SearchResult } from '../domain/types';

export type ProductSearchProvider = {
  readonly name: string;
  search(query: string): Promise<SearchResult>;
};

export type SearchStrategyHints = {
  /** Creator-supplied product URL. Enrich first; may skip Serper when strong. */
  seedMerchantUrl?: string;
  skipDiscoveryIfSeedStrong?: boolean;
};

export type SearchStrategy = {
  search(query: string, hints?: SearchStrategyHints): Promise<SearchResult>;
};

export type { SearchCandidate, SearchResult };
