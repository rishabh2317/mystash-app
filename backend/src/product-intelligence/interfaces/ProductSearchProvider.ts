import type { SearchCandidate, SearchResult } from '../domain/types';

export type ProductSearchProvider = {
  readonly name: string;
  search(query: string): Promise<SearchResult>;
};

export type SearchStrategyHints = {
  /** Creator-supplied product URL. Enrich first; may skip Serper when strong. */
  seedMerchantUrl?: string;
  skipDiscoveryIfSeedStrong?: boolean;
  /**
   * User-import only: enrich the full shortlist of commerce PDPs so Product Page
   * can show every valid discovered merchant. Creator ingest keeps the preferred
   * Official+Amazon early-stop path when this is unset/false.
   */
  enrichAllCommerce?: boolean;
  /**
   * User-import only: max ADDITIONAL merchant offers from discovery
   * (seed PDP retained separately when present). Independent of MAX_PRODUCTS_PER_IMPORT.
   */
  maxAdditionalMerchantOffers?: number;
  /**
   * User-import only: qualify additional merchants with URL/PDP classification
   * instead of full Tavily metadata enrichment (live price comes later).
   */
  lightweightAdditionalMerchants?: boolean;
  /**
   * User-import only: ISO country for regional discovery queries
   * (e.g. site:amazon.in). Never invents regional URL rewrites.
   */
  commerceCountry?: string | null;
};

export type SearchStrategy = {
  search(query: string, hints?: SearchStrategyHints): Promise<SearchResult>;
};

export type { SearchCandidate, SearchResult };
