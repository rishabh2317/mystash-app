import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchDocument, SearchEntityType, SearchFilters } from '../domain/types';
import type { LexicalCandidate, LexicalPage, SearchIndexPort, VectorCandidate } from '../ports';

type Row = { entity_type: SearchEntityType; id: string; score: number; document: SearchDocument };

/**
 * Render QA-only lexical adapter. Postgres triggers maintain the public projection
 * from authoritative rows, so public index-write routes cannot add private hits.
 */
export class PostgresQaSearchIndex implements SearchIndexPort {
  readonly supportsVector = false;
  constructor(private readonly db: SupabaseClient) {}

  async ping(): Promise<void> {
    const { error } = await this.db.rpc('search_qa_page', {
      p_query: 'health', p_exact: 'health', p_entity_type: 'product', p_filters: {}, p_limit: 1,
    });
    if (error) throw new Error(`PostgreSQL QA Search unavailable: ${error.code ?? error.message}`);
  }

  // The source-table triggers own updates and deletion. Search index hooks are
  // intentionally inert for this provider; they must not trust HTTP-supplied docs.
  async upsert(_doc: SearchDocument): Promise<void> {}
  async upsertMany(_docs: SearchDocument[]): Promise<void> {}
  async delete(_entityType: SearchEntityType, _id: string): Promise<void> {}

  async get(entityType: SearchEntityType, id: string): Promise<SearchDocument | null> {
    const docs = await this.getMany(entityType, [id]);
    return docs[0] ?? null;
  }

  private async rows(params: {
    q: string; exact?: string; entityType?: SearchEntityType; filters?: SearchFilters;
    limit: number; after?: [number, string] | null; excludeIds?: string[]; ids?: string[];
  }): Promise<Row[]> {
    const { data, error } = await this.db.rpc('search_qa_page', {
      p_query: params.q, p_exact: params.exact ?? params.q,
      p_entity_type: params.entityType ?? null, p_filters: params.filters ?? {},
      p_limit: params.limit, p_after_score: params.after?.[0] ?? null,
      p_after_id: params.after?.[1] ?? null, p_exclude_ids: params.excludeIds ?? [],
      p_ids: params.ids ?? null,
    });
    if (error) throw new Error(`PostgreSQL QA Search query failed: ${error.code ?? error.message}`);
    return (data ?? []) as Row[];
  }

  async lexicalSearch(params: {
    q: string; exact?: string; entityTypes?: SearchEntityType[];
    filters?: SearchFilters; limit: number;
  }): Promise<LexicalCandidate[]> {
    const types = params.entityTypes;
    if (types?.length === 0) return [];
    const requests = types && types.length > 1 ? types : [types?.[0]];
    const pages = await Promise.all(requests.map(entityType => this.rows({
      q: params.q, exact: params.exact, entityType, filters: params.filters,
      limit: Math.min(params.limit, 100),
    })));
    return pages.flat().sort((a,b) => b.score-a.score || a.id.localeCompare(b.id))
      .slice(0,params.limit).map(row => ({ entityType: row.entity_type, id: row.id,
        score: row.score, document: row.document }));
  }

  async lexicalPage(params: {
    q: string; exact?: string; entityType: SearchEntityType; filters?: SearchFilters;
    limit: number; after?: [number, string] | null; excludeIds?: string[];
  }): Promise<LexicalPage> {
    const rows = await this.rows({ ...params, limit: Math.min(params.limit + 1, 100) });
    const visible = rows.slice(0, params.limit);
    const last = visible.at(-1);
    return { candidates: visible.map(row => ({ entityType: row.entity_type, id: row.id,
      score: row.score, document: row.document })),
      after: last ? [last.score, last.id] : params.after ?? null,
      hasMore: rows.length > params.limit };
  }

  async getMany(entityType: SearchEntityType, ids: string[], filters?: SearchFilters): Promise<SearchDocument[]> {
    if (!ids.length) return [];
    const rows = await this.rows({ q: '', exact: '', entityType, filters, limit: Math.min(ids.length,100), ids });
    return rows.map(row => row.document);
  }

  async vectorSearch(_params: { vector: number[]; entityTypes?: SearchEntityType[];
    filters?: SearchFilters; limit: number }): Promise<VectorCandidate[]> { return []; }

  async autocomplete(params: { prefix: string; limit: number }): Promise<{
    text: string; id: string; entityType: SearchEntityType;
  }[]> {
    const hits = await this.lexicalSearch({ q: params.prefix, exact: params.prefix, limit: params.limit });
    return hits.map(({ document: d }) => ({ text: d.entityType === 'collection' ? d.searchTitle ?? d.slug
      : d.entityType === 'creator' ? d.displayName ?? d.username : d.name,
      id: d.id, entityType: d.entityType }));
  }

  async popular(params: { limit: number; entityType?: SearchEntityType }): Promise<SearchDocument[]> {
    let query = this.db.from('search_qa_documents').select('document').order('updated_at', { ascending: false })
      .limit(params.limit);
    if (params.entityType) query = query.eq('entity_type', params.entityType);
    const { data, error } = await query;
    if (error) throw new Error(`PostgreSQL QA Search popular query failed: ${error.code ?? error.message}`);
    return (data ?? []).map(row => row.document as SearchDocument);
  }
}
