import type { LexicalCandidate, SearchIndexPort, VectorCandidate } from '../ports';
import type { SearchDocument, SearchEntityType, SearchFilters } from '../domain/types';

export type EmbeddingSpace = {
  embeddingModelId: string;
  embeddingVersion: string;
  embeddingDimension: number;
};

export type OpenSearchConfig = {
  node: string;
  username?: string;
  password?: string;
  indexPrefix?: string;
  /** Expected embedding space for this serving generation. */
  embeddingSpace: EmbeddingSpace;
};

export class EmbeddingSpaceMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingSpaceMismatchError';
  }
}

export class OpenSearchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenSearchConfigError';
  }
}

type IndexMeta = EmbeddingSpace & { generation: number };

/**
 * OpenSearch adapter — frozen V1 search engine.
 *
 * Serving uses aliases:
 *   {prefix}_collections  →  {prefix}_collections_vN
 *   {prefix}_creators     →  {prefix}_creators_vN
 *   {prefix}_products     →  {prefix}_products_vN
 *
 * One embedding model/version/dimension per physical generation.
 */
export class OpenSearchIndex implements SearchIndexPort {
  private readonly prefix: string;
  private readonly authHeader: string | null;
  private readonly embeddingSpace: EmbeddingSpace;
  /** Cached generation per entity after ensure. */
  private generations = new Map<SearchEntityType, number>();

  constructor(private readonly cfg: OpenSearchConfig) {
    this.prefix = cfg.indexPrefix ?? 'mystash_search';
    this.embeddingSpace = cfg.embeddingSpace;
    if (cfg.username && cfg.password) {
      this.authHeader =
        'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    } else {
      this.authHeader = null;
    }
  }

  /** Logical serving alias (never a permanent physical index). */
  aliasName(entityType: SearchEntityType): string {
    return `${this.prefix}_${entityType}s`;
  }

  physicalName(entityType: SearchEntityType, generation: number): string {
    return `${this.prefix}_${entityType}s_v${generation}`;
  }

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    const res = await fetch(`${this.cfg.node.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenSearch ${method} ${path} → ${res.status}: ${text.slice(0, 800)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json();
    return null;
  }

  async ping(): Promise<void> {
    await this.req('GET', '/');
  }

  private mappingBody(dimension: number) {
    return {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        'index.knn': true,
        analysis: {
          analyzer: {
            autocomplete_index: {
              type: 'custom',
              tokenizer: 'autocomplete_tokenizer',
              filter: ['lowercase'],
            },
            autocomplete_search: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase'],
            },
          },
          tokenizer: {
            autocomplete_tokenizer: {
              type: 'edge_ngram',
              min_gram: 2,
              max_gram: 20,
              token_chars: ['letter', 'digit'],
            },
          },
        },
      },
      mappings: {
        _meta: {
          embeddingModelId: this.embeddingSpace.embeddingModelId,
          embeddingVersion: this.embeddingSpace.embeddingVersion,
          embeddingDimension: dimension,
        },
        properties: {
          entityType: { type: 'keyword' },
          id: { type: 'keyword' },
          searchableText: {
            type: 'text',
            analyzer: 'standard',
            fields: {
              autocomplete: {
                type: 'text',
                analyzer: 'autocomplete_index',
                search_analyzer: 'autocomplete_search',
              },
              sayt: { type: 'search_as_you_type' },
            },
          },
          suggestText: {
            type: 'search_as_you_type',
          },
          searchEligible: { type: 'boolean' },
          contentRevision: { type: 'long' },
          embedding: {
            type: 'knn_vector',
            dimension,
            method: { name: 'hnsw', space_type: 'cosinesimil', engine: 'nmslib' },
          },
          embeddingModelId: { type: 'keyword' },
          embeddingVersion: { type: 'keyword' },
          embeddingDimension: { type: 'integer' },
          // Opaque hydration blob only — do not index nested fields.
          // Indexing `document.embedding` dynamically conflicts with top-level knn_vector.
          document: { type: 'object', enabled: false },
        },
      },
    };
  }

  /**
   * Ensure serving aliases exist pointing at a generation matching embeddingSpace.
   * Creates v1 + alias if missing. Rebuilds generation if embedding space differs.
   */
  async ensureIndexes(): Promise<void> {
    const dim = this.embeddingSpace.embeddingDimension;
    for (const entityType of ['collection', 'creator', 'product'] as SearchEntityType[]) {
      const alias = this.aliasName(entityType);
      const existing = await this.resolveAlias(alias);
      if (existing) {
        const meta = await this.readIndexMeta(existing.physical);
        if (
          meta &&
          meta.embeddingModelId === this.embeddingSpace.embeddingModelId &&
          meta.embeddingVersion === this.embeddingSpace.embeddingVersion &&
          meta.embeddingDimension === dim
        ) {
          this.generations.set(entityType, existing.generation);
          continue;
        }
        // Incompatible space → new generation + atomic alias switch
        const nextGen = (existing.generation || 1) + 1;
        await this.createGeneration(entityType, nextGen);
        await this.switchAlias(entityType, nextGen, existing.physical);
        this.generations.set(entityType, nextGen);
        continue;
      }
      await this.createGeneration(entityType, 1);
      await this.switchAlias(entityType, 1, null);
      this.generations.set(entityType, 1);
    }
  }

  async createGeneration(entityType: SearchEntityType, generation: number): Promise<string> {
    const name = this.physicalName(entityType, generation);
    const body = this.mappingBody(this.embeddingSpace.embeddingDimension);
    // attach generation in _meta
    (body.mappings._meta as Record<string, unknown>).generation = generation;
    try {
      await this.req('PUT', `/${name}`, body);
    } catch (e) {
      // already exists
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('resource_already_exists') && !msg.includes('400')) throw e;
    }
    return name;
  }

  /**
   * Atomically point alias at new physical index; optionally remove old from alias.
   */
  async switchAlias(
    entityType: SearchEntityType,
    generation: number,
    previousPhysical: string | null,
  ): Promise<void> {
    const alias = this.aliasName(entityType);
    const physical = this.physicalName(entityType, generation);
    const actions: object[] = [{ add: { index: physical, alias } }];
    if (previousPhysical && previousPhysical !== physical) {
      actions.unshift({ remove: { index: previousPhysical, alias } });
    }
    await this.req('POST', '/_aliases', { actions });
    this.generations.set(entityType, generation);
  }

  /** Delete an old physical generation after safe period (caller decides timing). */
  async deleteGeneration(entityType: SearchEntityType, generation: number): Promise<void> {
    const name = this.physicalName(entityType, generation);
    const serving = await this.resolveAlias(this.aliasName(entityType));
    if (serving?.physical === name) {
      throw new OpenSearchConfigError(`Refusing to delete serving generation ${name}`);
    }
    try {
      await this.req('DELETE', `/${name}`);
    } catch {
      /* missing ok */
    }
  }

  /**
   * Start a rebuild: create next generation (empty), return name for bulk fill.
   * Caller bulk-upserts then calls promoteGeneration.
   */
  async beginRebuild(entityType: SearchEntityType): Promise<{ generation: number; physical: string }> {
    const current = (await this.resolveAlias(this.aliasName(entityType)))?.generation ?? 0;
    const generation = current + 1;
    const physical = await this.createGeneration(entityType, generation);
    return { generation, physical };
  }

  async promoteGeneration(entityType: SearchEntityType, generation: number): Promise<void> {
    const prev = await this.resolveAlias(this.aliasName(entityType));
    await this.switchAlias(entityType, generation, prev?.physical ?? null);
  }

  async resolveAlias(
    alias: string,
  ): Promise<{ physical: string; generation: number } | null> {
    try {
      const raw = (await this.req('GET', `/_alias/${alias}`)) as Record<
        string,
        { aliases?: Record<string, unknown> }
      >;
      const physical = Object.keys(raw)[0];
      if (!physical) return null;
      const m = physical.match(/_v(\d+)$/);
      const generation = m ? Number(m[1]) : 1;
      return { physical, generation };
    } catch {
      return null;
    }
  }

  private async readIndexMeta(physical: string): Promise<IndexMeta | null> {
    try {
      const raw = (await this.req('GET', `/${physical}/_mapping`)) as Record<
        string,
        { mappings?: { _meta?: Partial<IndexMeta> } }
      >;
      const meta = raw[physical]?.mappings?._meta;
      if (!meta?.embeddingModelId || !meta.embeddingVersion || !meta.embeddingDimension) {
        return null;
      }
      return {
        embeddingModelId: meta.embeddingModelId,
        embeddingVersion: meta.embeddingVersion,
        embeddingDimension: meta.embeddingDimension,
        generation: meta.generation ?? 1,
      };
    } catch {
      return null;
    }
  }

  private assertEmbeddingSpace(doc: SearchDocument): void {
    if (!doc.embedding || doc.embedding.length === 0) return;
    const { embeddingModelId, embeddingVersion, embeddingDimension } = this.embeddingSpace;
    if (
      doc.embeddingModelId !== embeddingModelId ||
      doc.embeddingVersion !== embeddingVersion ||
      doc.embeddingDimension !== embeddingDimension ||
      doc.embedding.length !== embeddingDimension
    ) {
      throw new EmbeddingSpaceMismatchError(
        `Embedding space mismatch for ${doc.entityType}:${doc.id}: ` +
          `doc=(${doc.embeddingModelId}/${doc.embeddingVersion}/${doc.embeddingDimension}) ` +
          `index=(${embeddingModelId}/${embeddingVersion}/${embeddingDimension}). ` +
          `Rebuild Search index generation before switching embedding models.`,
      );
    }
  }

  private suggestTextFor(doc: SearchDocument): string {
    if (doc.entityType === 'collection') return doc.searchTitle ?? doc.slug;
    if (doc.entityType === 'creator') return doc.displayName ?? doc.username;
    return doc.name;
  }

  /** Hydration payload without the dense vector (vector lives only at top-level `embedding`). */
  private hydrationDocument(doc: SearchDocument): Omit<SearchDocument, 'embedding'> & { embedding?: undefined } {
    const { embedding: _embedding, ...rest } = doc;
    return rest;
  }

  private sourceBody(doc: SearchDocument): Record<string, unknown> {
    this.assertEmbeddingSpace(doc);
    return {
      entityType: doc.entityType,
      id: doc.id,
      searchableText: doc.searchableText,
      suggestText: this.suggestTextFor(doc),
      searchEligible: doc.searchEligible,
      contentRevision: doc.contentRevision,
      embedding: doc.embedding,
      embeddingModelId: doc.embeddingModelId,
      embeddingVersion: doc.embeddingVersion,
      embeddingDimension: doc.embeddingDimension,
      document: this.hydrationDocument(doc),
    };
  }

  async upsert(doc: SearchDocument): Promise<void> {
    if (doc.deleted || !doc.searchEligible) {
      await this.delete(doc.entityType, doc.id);
      return;
    }
    const index = this.aliasName(doc.entityType);
    await this.req('PUT', `/${index}/_doc/${encodeURIComponent(doc.id)}?refresh=true`, this.sourceBody(doc));
  }

  async upsertMany(docs: SearchDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const lines: string[] = [];
    for (const doc of docs) {
      if (doc.deleted || !doc.searchEligible) {
        lines.push(
          JSON.stringify({
            delete: { _index: this.aliasName(doc.entityType), _id: doc.id },
          }),
        );
        continue;
      }
      this.assertEmbeddingSpace(doc);
      lines.push(
        JSON.stringify({ index: { _index: this.aliasName(doc.entityType), _id: doc.id } }),
      );
      lines.push(JSON.stringify(this.sourceBody(doc)));
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    const res = await fetch(`${this.cfg.node.replace(/\/$/, '')}/_bulk?refresh=true`, {
      method: 'POST',
      headers,
      body: lines.join('\n') + '\n',
    });
    if (!res.ok) {
      throw new Error(`OpenSearch bulk failed: ${res.status}`);
    }
    const parsed = (await res.json()) as { errors?: boolean; items?: unknown[] };
    if (parsed.errors) {
      throw new Error(`OpenSearch bulk completed with item errors`);
    }
  }

  /** Bulk into a specific physical generation (rebuild path). */
  async upsertManyIntoPhysical(physical: string, docs: SearchDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const lines: string[] = [];
    for (const doc of docs) {
      if (doc.deleted || !doc.searchEligible) continue;
      this.assertEmbeddingSpace(doc);
      lines.push(JSON.stringify({ index: { _index: physical, _id: doc.id } }));
      lines.push(JSON.stringify(this.sourceBody(doc)));
    }
    if (lines.length === 0) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    const res = await fetch(`${this.cfg.node.replace(/\/$/, '')}/_bulk?refresh=true`, {
      method: 'POST',
      headers,
      body: lines.join('\n') + '\n',
    });
    if (!res.ok) throw new Error(`OpenSearch bulk failed: ${res.status}`);
  }

  async delete(entityType: SearchEntityType, id: string): Promise<void> {
    try {
      await this.req(
        'DELETE',
        `/${this.aliasName(entityType)}/_doc/${encodeURIComponent(id)}?refresh=true`,
      );
    } catch {
      /* missing ok */
    }
  }

  async get(entityType: SearchEntityType, id: string): Promise<SearchDocument | null> {
    try {
      const raw = (await this.req(
        'GET',
        `/${this.aliasName(entityType)}/_doc/${encodeURIComponent(id)}`,
      )) as { _source?: { document?: SearchDocument } };
      return raw._source?.document ?? null;
    } catch {
      return null;
    }
  }

  private filterClause(_filters?: SearchFilters): object[] {
    return [{ term: { searchEligible: true } }];
  }

  async lexicalSearch(params: {
    q: string;
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<LexicalCandidate[]> {
    const types = params.entityTypes ?? ['collection', 'creator', 'product'];
    const index = types.map((t) => this.aliasName(t)).join(',');
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: params.q,
                fields: [
                  'searchableText^1',
                  'document.searchTitle^2',
                  'document.name^2',
                  'document.username^2',
                  'suggestText^1.5',
                ],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
          filter: this.filterClause(params.filters),
        },
      },
    })) as {
      hits?: { hits?: Array<{ _score?: number; _source?: { document?: SearchDocument } }> };
    };
    const out: LexicalCandidate[] = [];
    for (const h of raw.hits?.hits ?? []) {
      const doc = h._source?.document;
      if (!doc || !passesClientFilters(doc, params.filters)) continue;
      out.push({
        entityType: doc.entityType,
        id: doc.id,
        score: h._score ?? 0,
        document: doc,
      });
    }
    return out;
  }

  async vectorSearch(params: {
    vector: number[];
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<VectorCandidate[]> {
    if (params.vector.length !== this.embeddingSpace.embeddingDimension) {
      throw new EmbeddingSpaceMismatchError(
        `Query vector dim ${params.vector.length} != index ${this.embeddingSpace.embeddingDimension}`,
      );
    }
    const types = params.entityTypes ?? ['collection', 'creator', 'product'];
    const index = types.map((t) => this.aliasName(t)).join(',');
    // OpenSearch knn as top-level query (filter via post_filter for eligibility)
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      query: {
        knn: {
          embedding: {
            vector: params.vector,
            k: params.limit,
          },
        },
      },
      post_filter: {
        bool: { filter: this.filterClause(params.filters) },
      },
    })) as {
      hits?: { hits?: Array<{ _score?: number; _source?: { document?: SearchDocument } }> };
    };
    const out: VectorCandidate[] = [];
    for (const h of raw.hits?.hits ?? []) {
      const doc = h._source?.document;
      if (!doc || !passesClientFilters(doc, params.filters)) continue;
      out.push({
        entityType: doc.entityType,
        id: doc.id,
        score: h._score ?? 0,
        document: doc,
      });
    }
    return out;
  }

  async autocomplete(params: {
    prefix: string;
    limit: number;
  }): Promise<Array<{ text: string; id: string; entityType: SearchEntityType }>> {
    const index = ['collection', 'creator', 'product']
      .map((t) => this.aliasName(t as SearchEntityType))
      .join(',');
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      query: {
        bool: {
          should: [
            {
              multi_match: {
                query: params.prefix,
                type: 'bool_prefix',
                fields: [
                  'suggestText',
                  'suggestText._2gram',
                  'suggestText._3gram',
                  'searchableText.sayt',
                  'searchableText.sayt._2gram',
                  'searchableText.sayt._3gram',
                ],
              },
            },
            {
              match: {
                'searchableText.autocomplete': {
                  query: params.prefix,
                  operator: 'and',
                },
              },
            },
          ],
          minimum_should_match: 1,
          filter: [{ term: { searchEligible: true } }],
        },
      },
    })) as {
      hits?: { hits?: Array<{ _source?: { document?: SearchDocument; suggestText?: string } }> };
    };
    const out: Array<{ text: string; id: string; entityType: SearchEntityType }> = [];
    for (const h of raw.hits?.hits ?? []) {
      const doc = h._source?.document;
      if (!doc) continue;
      const text = h._source?.suggestText ?? this.suggestTextFor(doc);
      out.push({ text, id: doc.id, entityType: doc.entityType });
    }
    return out.slice(0, params.limit);
  }

  async popular(params: {
    limit: number;
    entityType?: SearchEntityType;
  }): Promise<SearchDocument[]> {
    const types = params.entityType
      ? [params.entityType]
      : (['collection', 'creator', 'product'] as SearchEntityType[]);
    const index = types.map((t) => this.aliasName(t)).join(',');
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      query: { term: { searchEligible: true } },
      sort: [{ 'document.savesCount': { order: 'desc', unmapped_type: 'long' } }],
    })) as {
      hits?: { hits?: Array<{ _source?: { document?: SearchDocument } }> };
    };
    return (raw.hits?.hits ?? [])
      .map((h) => h._source?.document)
      .filter((d): d is SearchDocument => Boolean(d))
      .slice(0, params.limit);
  }
}

function passesClientFilters(doc: SearchDocument, filters?: SearchFilters): boolean {
  if (!filters) return true;
  if (filters.creatorId) {
    if (doc.entityType === 'collection' && doc.creator.creatorId !== filters.creatorId) return false;
    if (doc.entityType === 'creator' && doc.userId !== filters.creatorId) return false;
  }
  if (filters.brand && doc.entityType === 'product') {
    if ((doc.brand ?? '').toLowerCase() !== filters.brand.toLowerCase()) return false;
  }
  if (filters.verifiedOnly && doc.entityType === 'product') {
    const v = (doc.verificationStatus ?? '').toLowerCase();
    if (v !== 'verified' && v !== 'high') return false;
  }
  if (filters.priceMin != null || filters.priceMax != null) {
    if (doc.entityType !== 'product' || doc.priceAmount == null) return false;
    if (filters.priceMin != null && doc.priceAmount < filters.priceMin) return false;
    if (filters.priceMax != null && doc.priceAmount > filters.priceMax) return false;
  }
  return true;
}
