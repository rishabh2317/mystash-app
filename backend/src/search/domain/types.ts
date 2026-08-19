/**
 * Search domain types — disposable projections only.
 * SoT remains Collection / Catalog / User / Engagement.
 */

export type SearchEntityType = 'collection' | 'creator' | 'product';

export type QueryIntent =
  | 'EXACT_PRODUCT'
  | 'CREATOR'
  | 'DISCOVERY'
  | 'CATEGORY_CONCEPT'
  | 'COMPARISON'
  | 'COMMERCE'
  | 'TRENDING';

export type CreatorSnapshotDenorm = {
  creatorId: string;
  displayName: string | null;
  username: string | null;
  avatarRef: string | null;
};

export type EmbeddingMeta = {
  embedding: number[];
  embeddingModelId: string;
  embeddingVersion: string;
  embeddingDimension: number;
};

/** Shared fields on every SearchDocument. */
export type SearchDocumentBase = {
  id: string;
  entityType: SearchEntityType;
  searchableText: string;
  searchEligible: boolean;
  contentRevision: number;
  indexedAt: string;
  deleted?: boolean;
} & Partial<EmbeddingMeta>;

export type CollectionSearchDocument = SearchDocumentBase & {
  entityType: 'collection';
  collectionId: string;
  slug: string;
  searchTitle: string | null;
  searchKeywords: string[];
  searchBrands: string[];
  searchCategories: string[];
  creator: CreatorSnapshotDenorm;
  primaryMediaRef: string | null;
  productTagCount: number;
  publishedAt: string | null;
  qualityScore: number | null;
  viewsCount: number;
  savesCount: number;
  sharesCount: number;
  productClicksCount: number;
  creatorAuthority: number;
  saveRate: number | null;
};

export type CreatorSearchDocument = SearchDocumentBase & {
  entityType: 'creator';
  userId: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarRef: string | null;
  followersCount: number;
  creatorAuthority: number;
};

export type CatalogProductSearchDocument = SearchDocumentBase & {
  entityType: 'product';
  catalogProductId: string;
  canonicalSlug: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  aliases: string[];
  verificationStatus: string | null;
  primaryImageRef: string | null;
  popularity: number;
  lastVerifiedAt: string | null;
  /** Search-side denorm only — never live Shopping. */
  priceAmount: number | null;
  priceCurrency: string | null;
};

export type SearchDocument =
  | CollectionSearchDocument
  | CreatorSearchDocument
  | CatalogProductSearchDocument;

export type SearchFilters = {
  creatorId?: string;
  brand?: string;
  category?: string;
  verifiedOnly?: boolean;
  recentlyPublished?: boolean;
  popular?: boolean;
  /** Only applied when docs carry denorm price. */
  priceMin?: number;
  priceMax?: number;
};

export type SearchQueryInput = {
  q: string;
  userId?: string | null;
  cursor?: string | null;
  limit?: number;
  /** unified | typed sections */
  presentation?: 'unified' | 'typed';
  filters?: SearchFilters;
  /** Disable vector lane (tests / degradation). */
  lexicalOnly?: boolean;
};

export type RankedHit = {
  entityType: SearchEntityType;
  id: string;
  score: number;
  lexicalScore: number;
  vectorScore: number;
  document: SearchDocument;
};

export type SearchResultCard = {
  entityType: SearchEntityType;
  id: string;
  score: number;
  title: string;
  subtitle: string | null;
  imageRef: string | null;
  /** Collection-specific FE-agnostic fields */
  slug?: string | null;
  primaryMediaRef?: string | null;
  creator?: CreatorSnapshotDenorm | null;
  productTagCount?: number;
  username?: string | null;
  verificationStatus?: string | null;
};

export type BlendedSearchResponse = {
  query: string;
  intent: QueryIntent;
  retrievalMode: 'hybrid' | 'lexical_only' | 'semantic_only';
  presentation: 'unified' | 'typed';
  results: SearchResultCard[];
  lanes?: {
    collections: SearchResultCard[];
    creators: SearchResultCard[];
    products: SearchResultCard[];
  };
  nextCursor: string | null;
  zeroResult: boolean;
  latencyMs: number;
  degraded?: string[];
};

export type AutocompleteSuggestion = {
  kind: 'collection' | 'creator' | 'product' | 'recent' | 'trending';
  text: string;
  id?: string;
  entityType?: SearchEntityType;
};

export type AutocompleteResponse = {
  query: string;
  suggestions: AutocompleteSuggestion[];
};

export type SearchTelemetryEvent = {
  eventType:
    | 'query'
    | 'impression'
    | 'click'
    | 'abandonment'
    | 'zero_result'
    | 'autocomplete';
  query?: string;
  userId?: string | null;
  anonymousId?: string | null;
  resultIds?: string[];
  clickedId?: string;
  clickedEntityType?: SearchEntityType;
  latencyMs?: number;
  intent?: QueryIntent;
  retrievalMode?: string;
  occurredAt: string;
};
