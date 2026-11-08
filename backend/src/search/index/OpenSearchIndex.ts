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

type IndexMeta = EmbeddingSpace & { generation: number; mappingVersion?: number };
const SEARCH_MAPPING_VERSION = 2;

/**
 * OpenSearch adapter — versioned public Search projection.
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
  private startupCheck: Promise<void> | null = null;

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

  startStartupCheck(): Promise<void> {
    this.startupCheck = this.ensureIndexes();
    return this.startupCheck;
  }

  private async requireReady(): Promise<void> {
    if (this.startupCheck) await this.startupCheck;
  }

  private mappingBody(dimension: number) {
    return {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        'index.knn': true,
        analysis: {
          normalizer: {
            search_keyword: { type: 'custom', filter: ['lowercase', 'asciifolding'] },
          },
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
          mappingVersion: SEARCH_MAPPING_VERSION,
        },
        properties: {
          entityType: { type: 'keyword' },
          id: { type: 'keyword' },
          primaryText: { type: 'text', fields: { exact: { type: 'keyword', normalizer: 'search_keyword' } } },
          secondaryText: { type: 'text' },
          handle: { type: 'keyword', normalizer: 'search_keyword' },
          creatorId: { type: 'keyword' },
          brands: { type: 'keyword', normalizer: 'search_keyword' },
          categories: { type: 'keyword', normalizer: 'search_keyword' },
          verificationStatus: { type: 'keyword', normalizer: 'search_keyword' },
          priceAmount: { type: 'double' },
          publishedAt: { type: 'date' },
          popularity: { type: 'double' },
          followersCount: { type: 'long' },
          engagementCount: { type: 'long' },
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
            method: { name: 'hnsw', space_type: 'cosinesimil', engine: 'lucene' },
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
          meta.embeddingDimension === dim &&
          meta.mappingVersion === SEARCH_MAPPING_VERSION
        ) {
          this.generations.set(entityType, existing.generation);
          continue;
        }
        throw new OpenSearchConfigError(
          `Search index ${existing.physical} needs a complete generation rebuild before serving mapping v${SEARCH_MAPPING_VERSION}. ` +
          'Use beginRebuild, bulk-fill, validate, then promoteGeneration; the current alias was not changed.',
        );
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
    (body.mappings._meta as Record<string, unknown>).mappingVersion = SEARCH_MAPPING_VERSION;
    try {
      await this.req('PUT', `/${name}`, body);
    } catch (e) {
      // already exists
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('resource_already_exists_exception')) throw e;
    }
    const meta = await this.readIndexMeta(name);
    if (meta?.mappingVersion !== SEARCH_MAPPING_VERSION ||
      meta.embeddingModelId !== this.embeddingSpace.embeddingModelId ||
      meta.embeddingVersion !== this.embeddingSpace.embeddingVersion ||
      meta.embeddingDimension !== this.embeddingSpace.embeddingDimension) {
      throw new OpenSearchConfigError(`Generation ${name} has an incompatible mapping or embedding space`);
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

  /** Copy the current public projection into a new mapping generation. Caller pauses writers and promotes later. */
  async copyServingToGeneration(entityType: SearchEntityType, generation: number): Promise<{ sourceCount: number; targetCount: number }> {
    const source = await this.resolveAlias(this.aliasName(entityType));
    const target = this.physicalName(entityType, generation);
    if (!source || source.physical === target) throw new OpenSearchConfigError('Source and target generations must differ');
    const targetMeta = await this.readIndexMeta(target);
    if (targetMeta?.mappingVersion !== SEARCH_MAPPING_VERSION) throw new OpenSearchConfigError('Target mapping version is incompatible');
    if (await this.indexCount(target) !== 0) throw new OpenSearchConfigError('Target generation is not empty; refusing an ambiguous rebuild');
    let scrollId: string | undefined;
    try {
      let raw = (await this.req('POST', `/${source.physical}/_search?scroll=2m`, {
        size: 500, sort: ['_doc'], query: { match_all: {} },
      })) as { _scroll_id?: string; hits?: { hits?: Array<{ _source?: { document?: SearchDocument; embedding?: number[] } }> } };
      while (true) {
        scrollId = raw._scroll_id ?? scrollId;
        const hits = raw.hits?.hits ?? [];
        if (!hits.length) break;
        const docs: SearchDocument[] = [];
        for (const hit of hits) {
          const document = hit._source?.document;
          if (!document) throw new OpenSearchConfigError('Source index contains a document without its projection');
          docs.push({ ...document, embedding: hit._source?.embedding ?? document.embedding } as SearchDocument);
        }
        await this.upsertManyIntoPhysical(target, docs);
        if (!scrollId) throw new OpenSearchConfigError('OpenSearch scroll cursor missing');
        raw = (await this.req('POST', '/_search/scroll', { scroll: '2m', scroll_id: scrollId })) as typeof raw;
      }
    } finally {
      if (scrollId) await this.req('DELETE', '/_search/scroll', { scroll_id: [scrollId] }).catch(() => {});
    }
    const sourceCount = await this.indexCount(source.physical);
    const targetCount = await this.indexCount(target);
    if (sourceCount !== targetCount) throw new OpenSearchConfigError(`Rebuild count mismatch: source=${sourceCount} target=${targetCount}`);
    return { sourceCount, targetCount };
  }

  async indexCount(index: string): Promise<number> {
    const raw = (await this.req('GET', `/${index}/_count`)) as { count?: number };
    if (!Number.isSafeInteger(raw.count)) throw new OpenSearchConfigError(`Invalid count for ${index}`);
    return raw.count!;
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
        mappingVersion: meta.mappingVersion,
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
    const primaryText = doc.entityType === 'collection' ? doc.searchTitle ?? doc.slug
      : doc.entityType === 'creator' ? doc.displayName ?? doc.username : doc.name;
    const secondaryText = doc.entityType === 'collection'
      ? [doc.slug, doc.creator.displayName, doc.creator.username].filter(Boolean).join(' ')
      : doc.entityType === 'creator' ? doc.username : [doc.brand, doc.model, doc.category].filter(Boolean).join(' ');
    return {
      entityType: doc.entityType,
      id: doc.id,
      primaryText,
      secondaryText,
      handle: doc.entityType === 'creator' ? doc.username : undefined,
      creatorId: doc.entityType === 'collection' ? doc.creator.creatorId : doc.entityType === 'creator' ? doc.userId : undefined,
      brands: doc.entityType === 'collection' ? doc.searchBrands : doc.entityType === 'product' ? doc.brand : undefined,
      categories: doc.entityType === 'collection' ? doc.searchCategories : doc.entityType === 'product' ? doc.category : undefined,
      verificationStatus: doc.entityType === 'product' ? doc.verificationStatus : undefined,
      priceAmount: doc.entityType === 'product' ? doc.priceAmount : undefined,
      publishedAt: doc.entityType === 'collection' ? doc.publishedAt : undefined,
      popularity: doc.entityType === 'product' ? doc.popularity : undefined,
      followersCount: doc.entityType === 'creator' ? doc.followersCount : undefined,
      engagementCount: doc.entityType === 'collection' ? doc.savesCount + doc.viewsCount : undefined,
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
    await this.requireReady();
    if (doc.deleted || !doc.searchEligible) {
      await this.delete(doc.entityType, doc.id);
      return;
    }
    const index = this.aliasName(doc.entityType);
    await this.req('PUT', `/${index}/_doc/${encodeURIComponent(doc.id)}?refresh=true`, this.sourceBody(doc));
  }

  async upsertMany(docs: SearchDocument[]): Promise<void> {
    await this.requireReady();
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
    await this.requireReady();
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
    await this.requireReady();
    try {
      const raw = (await this.req(
        'GET',
        `/${this.aliasName(entityType)}/_doc/${encodeURIComponent(id)}`,
      )) as { _source?: { document?: SearchDocument; embedding?: number[] } };
      const document = raw._source?.document;
      return document ? { ...document, embedding: raw._source?.embedding ?? document.embedding } as SearchDocument : null;
    } catch {
      return null;
    }
  }

  private filterClause(filters?: SearchFilters): object[] {
    const clauses: object[] = [{ term: { searchEligible: true } }];
    if (!filters) return clauses;
    if (filters.creatorId) clauses.push({ term: { creatorId: filters.creatorId } });
    if (filters.brand) clauses.push({ term: { brands: filters.brand.toLowerCase() } });
    if (filters.category) clauses.push({ term: { categories: filters.category.toLowerCase() } });
    if (filters.verifiedOnly) clauses.push({ bool: { should: [
      { bool: { must_not: [{ term: { entityType: 'product' } }] } },
      { terms: { verificationStatus: ['verified', 'high'] } },
    ], minimum_should_match: 1 } });
    if (filters.recentlyPublished) clauses.push({ bool: { should: [
      { bool: { must_not: [{ term: { entityType: 'collection' } }] } },
      { range: { publishedAt: { gte: 'now-30d' } } },
    ], minimum_should_match: 1 } });
    if (filters.popular) clauses.push({ bool: { should: [
      { range: { engagementCount: { gte: 10 } } },
      { range: { followersCount: { gte: 10 } } },
      { range: { popularity: { gte: 5 } } },
    ], minimum_should_match: 1 } });
    if (filters.priceMin != null || filters.priceMax != null) {
      clauses.push({ range: { priceAmount: {
        ...(filters.priceMin != null ? { gte: filters.priceMin } : {}),
        ...(filters.priceMax != null ? { lte: filters.priceMax } : {}),
      } } });
    }
    return clauses;
  }

  private lexicalQuery(q: string, filters?: SearchFilters, excludeIds?: string[], exact = q): object {
    const normalized = exact.trim().toLowerCase();
    return { bool: {
      should: [
        { term: { 'primaryText.exact': { value: normalized, boost: 12 } } },
        { term: { handle: { value: normalized.replace(/^@/, ''), boost: 14 } } },
        { match_phrase: { primaryText: { query: exact, boost: 7 } } },
        { multi_match: { query: q, fields: ['primaryText^5', 'secondaryText^2', 'searchableText'],
          type: 'best_fields', fuzziness: 'AUTO' } },
      ],
      minimum_should_match: 1,
      filter: this.filterClause(filters),
      ...(excludeIds?.length ? { must_not: [{ ids: { values: excludeIds } }] } : {}),
    } };
  }

  async lexicalPage(params: {
    q: string; exact?: string; entityType: SearchEntityType; filters?: SearchFilters; limit: number;
    after?: [number, string] | null; excludeIds?: string[];
  }): Promise<{ candidates: LexicalCandidate[]; after: [number, string] | null; hasMore: boolean }> {
    await this.requireReady();
    const raw = (await this.req('POST', `/${this.aliasName(params.entityType)}/_search`, {
      size: params.limit + 1,
      _source: { excludes: ['embedding'] },
      query: this.lexicalQuery(params.q, params.filters, params.excludeIds, params.exact),
      sort: [{ _score: 'desc' }, { id: 'asc' }],
      ...(params.after ? { search_after: params.after } : {}),
    })) as { hits?: { hits?: Array<{ _score?: number; sort?: [number, string]; _source?: { document?: SearchDocument } }> } };
    const hits = raw.hits?.hits ?? [];
    const page = hits.slice(0, params.limit);
    const candidates = page.map(h => h._source?.document && {
      entityType: h._source.document.entityType, id: h._source.document.id,
      score: h._score ?? 0, document: h._source.document,
    }).filter((v): v is LexicalCandidate => Boolean(v));
    return { candidates, after: page.at(-1)?.sort ?? null, hasMore: hits.length > params.limit };
  }

  async getMany(entityType: SearchEntityType, ids: string[], filters?: SearchFilters): Promise<SearchDocument[]> {
    await this.requireReady();
    if (!ids.length) return [];
    const raw = (await this.req('POST', `/${this.aliasName(entityType)}/_search`, {
      size: ids.length, _source: { excludes: ['embedding'] },
      query: { bool: { filter: [...this.filterClause(filters), { ids: { values: ids } }] } },
    })) as { hits?: { hits?: Array<{ _source?: { document?: SearchDocument } }> } };
    return (raw.hits?.hits ?? []).map(d => d._source?.document)
      .filter((d): d is SearchDocument => Boolean(d?.searchEligible && !d.deleted && passesClientFilters(d, filters)));
  }

  async lexicalSearch(params: {
    q: string;
    exact?: string;
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<LexicalCandidate[]> {
    await this.requireReady();
    const types = params.entityTypes ?? ['collection', 'creator', 'product'];
    const index = types.map((t) => this.aliasName(t)).join(',');
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      _source: { excludes: ['embedding'] },
      query: this.lexicalQuery(params.q, params.filters, undefined, params.exact),
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
    await this.requireReady();
    if (params.vector.length !== this.embeddingSpace.embeddingDimension) {
      throw new EmbeddingSpaceMismatchError(
        `Query vector dim ${params.vector.length} != index ${this.embeddingSpace.embeddingDimension}`,
      );
    }
    const types = params.entityTypes ?? ['collection', 'creator', 'product'];
    const index = types.map((t) => this.aliasName(t)).join(',');
    // Lucene HNSW applies eligibility and structured filters within k-NN retrieval.
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      _source: { excludes: ['embedding'] },
      query: {
        knn: {
          embedding: {
            vector: params.vector,
            k: params.limit,
            filter: { bool: { filter: this.filterClause(params.filters) } },
          },
        },
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
    await this.requireReady();
    const index = ['collection', 'creator', 'product']
      .map((t) => this.aliasName(t as SearchEntityType))
      .join(',');
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      _source: { excludes: ['embedding'] },
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
    await this.requireReady();
    const types = params.entityType
      ? [params.entityType]
      : (['collection', 'creator', 'product'] as SearchEntityType[]);
    const index = types.map((t) => this.aliasName(t)).join(',');
    const raw = (await this.req('POST', `/${index}/_search`, {
      size: params.limit,
      _source: { excludes: ['embedding'] },
      query: { term: { searchEligible: true } },
      sort: [{ engagementCount: { order: 'desc', unmapped_type: 'long' } }],
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
    if (doc.entityType === 'product') return false;
  }
  if (filters.brand) {
    const brand = filters.brand.toLowerCase();
    if (doc.entityType === 'collection' && !doc.searchBrands.some(v => v.toLowerCase() === brand)) return false;
    if (doc.entityType === 'product' && (doc.brand ?? '').toLowerCase() !== brand) return false;
    if (doc.entityType === 'creator') return false;
  }
  if (filters.category) {
    const category = filters.category.toLowerCase();
    if (doc.entityType === 'collection' && !doc.searchCategories.some(v => v.toLowerCase() === category)) return false;
    if (doc.entityType === 'product' && (doc.category ?? '').toLowerCase() !== category) return false;
    if (doc.entityType === 'creator') return false;
  }
  if (filters.verifiedOnly && doc.entityType === 'product') {
    const v = (doc.verificationStatus ?? '').toLowerCase();
    if (v !== 'verified' && v !== 'high') return false;
  }
  if (filters.recentlyPublished && doc.entityType === 'collection') {
    if (!doc.publishedAt || Date.now() - Date.parse(doc.publishedAt) > 30 * 86_400_000) return false;
  }
  if (filters.popular) {
    if (doc.entityType === 'collection' && doc.savesCount + doc.viewsCount < 10) return false;
    if (doc.entityType === 'creator' && doc.followersCount < 10) return false;
    if (doc.entityType === 'product' && doc.popularity < 5) return false;
  }
  if (filters.priceMin != null || filters.priceMax != null) {
    if (doc.entityType !== 'product' || doc.priceAmount == null) return false;
    if (filters.priceMin != null && doc.priceAmount < filters.priceMin) return false;
    if (filters.priceMax != null && doc.priceAmount > filters.priceMax) return false;
  }
  return true;
}
