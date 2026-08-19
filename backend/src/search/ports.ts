import type { SearchDocument, SearchEntityType, SearchFilters } from './domain/types';

export type LexicalCandidate = {
  entityType: SearchEntityType;
  id: string;
  score: number;
  document: SearchDocument;
};

export type VectorCandidate = {
  entityType: SearchEntityType;
  id: string;
  score: number;
  document: SearchDocument;
};

export type HybridCandidate = {
  entityType: SearchEntityType;
  id: string;
  lexicalScore: number;
  vectorScore: number;
  fusionScore: number;
  document: SearchDocument;
};

/**
 * Search index port — OpenSearch in prod, in-memory for tests/dev without Docker.
 * Owns retrieval primitives only; Mystash SearchService owns final ranking.
 */
export type SearchIndexPort = {
  upsert(doc: SearchDocument): Promise<void>;
  upsertMany(docs: SearchDocument[]): Promise<void>;
  delete(entityType: SearchEntityType, id: string): Promise<void>;
  get(entityType: SearchEntityType, id: string): Promise<SearchDocument | null>;
  lexicalSearch(params: {
    q: string;
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<LexicalCandidate[]>;
  vectorSearch(params: {
    vector: number[];
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<VectorCandidate[]>;
  autocomplete(params: {
    prefix: string;
    limit: number;
  }): Promise<Array<{ text: string; id: string; entityType: SearchEntityType }>>;
  /** Popular docs for zero-result / related suggestions. */
  popular(params: { limit: number; entityType?: SearchEntityType }): Promise<SearchDocument[]>;
};
