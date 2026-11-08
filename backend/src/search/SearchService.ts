import { EmbeddingError, type EmbeddingPort } from './embeddings/EmbeddingPort';
import { createHash } from 'node:crypto';
import { fuseHybridCandidates } from './domain/hybrid';
import { detectQueryIntent } from './domain/intent';
import { prepareQuery, prepareSearchQuery } from './domain/queryPrep';
import { blendResults, rankCandidates, toResultCard } from './domain/ranking';
import type {
  AutocompleteResponse,
  AutocompleteSuggestion,
  BlendedSearchResponse,
  SearchDocument,
  SearchEntityType,
  SearchFilters,
  SearchQueryInput,
} from './domain/types';
import {
  buildCollectionSearchDocument,
  buildCreatorSearchDocument,
  buildProductSearchDocument,
  type CollectionIndexInput,
  type CreatorIndexInput,
  type ProductIndexInput,
} from './documents';
import type { SearchIndexPort } from './ports';
import { emitSearchOps } from './observability';
import { SearchTelemetryStore } from './telemetry';

export class SearchServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'SearchServiceError';
  }
}

type QueryEmbedCacheEntry = { embedding: number[]; expiresAt: number };
type EntityCursor = { v: 2; key: string; ids: string[]; pos: number;
  after: [number, string] | null; hasTail: boolean; fallback: boolean;
  headMode: 'hybrid' | 'lexical_only' };

function entityCursorKey(q: string, entityType: SearchEntityType, filters?: SearchFilters, lexicalOnly?: boolean): string {
  return createHash('sha256').update(JSON.stringify({ q, entityType, filters, lexicalOnly: Boolean(lexicalOnly) })).digest('base64url').slice(0, 24);
}

function readEntityCursor(raw: string, key: string): EntityCursor {
  try {
    if (raw.length > 12000) throw new Error('too long');
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as EntityCursor;
    if (value.v !== 2 || value.key !== key || !Array.isArray(value.ids) || value.ids.length > 120 ||
      !value.ids.every(id => typeof id === 'string' && id.length <= 200) ||
      !Number.isInteger(value.pos) || value.pos < 0 || value.pos > value.ids.length ||
      typeof value.hasTail !== 'boolean' || typeof value.fallback !== 'boolean' ||
      (value.headMode !== 'hybrid' && value.headMode !== 'lexical_only') ||
      (value.after !== null && (!Array.isArray(value.after) || value.after.length !== 2 ||
        typeof value.after[0] !== 'number' || typeof value.after[1] !== 'string'))) throw new Error('invalid');
    return value;
  } catch {
    throw new SearchServiceError('Invalid search cursor', 400);
  }
}

function writeEntityCursor(value: EntityCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Search application boundary — indexing, hybrid retrieval, deterministic ranking/blend.
 * OpenSearch (or in-memory) = retrieval infra; this service owns product relevance semantics.
 */
export class SearchService {
  private readonly queryEmbedCache = new Map<string, QueryEmbedCacheEntry>();
  private readonly queryEmbedInFlight = new Map<string, Promise<number[]>>();
  private readonly queryEmbedTtlMs = 10 * 60_000;
  private readonly queryEmbedMaxEntries = 512;

  constructor(
    private readonly index: SearchIndexPort,
    private readonly embeddings: EmbeddingPort,
    private readonly telemetry: SearchTelemetryStore = new SearchTelemetryStore(),
  ) {}

  getTelemetry(): SearchTelemetryStore {
    return this.telemetry;
  }

  // ── Indexing (async / event-driven entry points) ──────────────────────────

  async indexCollection(input: CollectionIndexInput): Promise<void> {
    let doc = buildCollectionSearchDocument(input);
    if (!doc.searchEligible || doc.deleted) {
      await this.index.delete('collection', doc.id);
      emitSearchOps('SearchIndexDeleted', { entityType: 'collection', id: doc.id });
      return;
    }
    doc = await this.attachEmbedding(doc);
    await this.index.upsert(doc);
    emitSearchOps('SearchIndexed', {
      entityType: 'collection',
      id: doc.id,
      revision: doc.contentRevision,
    });
  }

  async indexCreator(input: CreatorIndexInput): Promise<void> {
    let doc = buildCreatorSearchDocument(input);
    if (!doc.searchEligible || doc.deleted) {
      await this.index.delete('creator', doc.id);
      emitSearchOps('SearchIndexDeleted', { entityType: 'creator', id: doc.id });
      return;
    }
    doc = await this.attachEmbedding(doc);
    await this.index.upsert(doc);
    emitSearchOps('SearchIndexed', { entityType: 'creator', id: doc.id });
  }

  /**
   * Refresh nested creator snapshot on Collection docs (async User event path).
   * Caller supplies collection ids that reference this creator.
   */
  async refreshCreatorSnapshotOnCollections(params: {
    creatorId: string;
    displayName: string | null;
    username: string | null;
    avatarRef: string | null;
    collectionIds: string[];
  }): Promise<void> {
    for (const id of params.collectionIds) {
      const existing = await this.index.get('collection', id);
      if (!existing || existing.entityType !== 'collection') continue;
      const updated: SearchDocument = {
        ...existing,
        creator: {
          creatorId: params.creatorId,
          displayName: params.displayName,
          username: params.username,
          avatarRef: params.avatarRef,
        },
        searchableText: [
          existing.searchTitle,
          existing.searchKeywords.join(' '),
          params.displayName,
          params.username,
        ]
          .filter(Boolean)
          .join(' '),
        contentRevision: existing.contentRevision + 1,
      };
      const withEmb = await this.attachEmbedding(updated);
      await this.index.upsert(withEmb);
    }
  }

  async indexProduct(input: ProductIndexInput): Promise<void> {
    let doc = buildProductSearchDocument(input);
    if (!doc.searchEligible || doc.deleted) {
      await this.index.delete('product', doc.id);
      emitSearchOps('SearchIndexDeleted', { entityType: 'product', id: doc.id });
      return;
    }
    doc = await this.attachEmbedding(doc);
    await this.index.upsert(doc);
    emitSearchOps('SearchIndexed', { entityType: 'product', id: doc.id });
  }

  async deleteEntity(
    entityType: 'collection' | 'creator' | 'product',
    id: string,
  ): Promise<void> {
    await this.index.delete(entityType, id);
    emitSearchOps('SearchIndexDeleted', { entityType, id });
  }

  /**
   * Nearline Engagement projection refresh — never per-event.
   */
  async applyCollectionEngagementMirrors(
    collectionId: string,
    mirrors: {
      viewsCount?: number;
      savesCount?: number;
      sharesCount?: number;
      productClicksCount?: number;
      creatorAuthority?: number;
      saveRate?: number | null;
    },
  ): Promise<void> {
    const existing = await this.index.get('collection', collectionId);
    if (!existing || existing.entityType !== 'collection') return;
    const updated: SearchDocument = {
      ...existing,
      viewsCount: mirrors.viewsCount ?? existing.viewsCount,
      savesCount: mirrors.savesCount ?? existing.savesCount,
      sharesCount: mirrors.sharesCount ?? existing.sharesCount,
      productClicksCount: mirrors.productClicksCount ?? existing.productClicksCount,
      creatorAuthority: mirrors.creatorAuthority ?? existing.creatorAuthority,
      saveRate: mirrors.saveRate !== undefined ? mirrors.saveRate : existing.saveRate,
      // Do not bump contentRevision / re-embed for counter-only updates
    };
    await this.index.upsert(updated);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  async search(input: SearchQueryInput): Promise<BlendedSearchResponse> {
    const started = Date.now();
    const prepared = prepareSearchQuery(input.q ?? '');
    if (!prepared.normalized) {
      throw new SearchServiceError('q required', 400);
    }

    const { intent, laneWeights } = detectQueryIntent(prepared.corrected);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const presentation = input.presentation ?? 'unified';
    const degraded: string[] = [];
    let retrievalMode: BlendedSearchResponse['retrievalMode'] = 'hybrid';

    const filters: SearchQueryInput['filters'] = { ...(input.filters ?? {}) };
    if (prepared.priceMin != null) {
      filters.priceMin = prepared.priceMin;
    }
    if (prepared.priceMax != null) {
      filters.priceMax = prepared.priceMax;
    }
    const activeFilters = Object.keys(filters).length ? filters : undefined;

    if (input.entityType && this.index.lexicalPage && this.index.getMany) {
      return this.searchEntityPage({ input, started, query: prepared.corrected, expanded: prepared.expanded,
        entityType: input.entityType, filters: activeFilters, intent, laneWeights, limit, presentation });
    }

    const candidateLimit = Math.max(limit * 3, 40);
    const entityTypes = input.entityType ? [input.entityType] : undefined;

    let lexical = await this.index.lexicalSearch({
      q: prepared.expanded,
      exact: prepared.corrected,
      entityTypes,
      filters: activeFilters,
      limit: candidateLimit,
    });

    let vector: Awaited<ReturnType<SearchIndexPort['vectorSearch']>> = [];
    if (!input.lexicalOnly) {
      try {
        const emb = await this.embedQueryCached(prepared.corrected);
        vector = await this.index.vectorSearch({
          vector: emb,
          entityTypes,
          filters: activeFilters,
          limit: candidateLimit,
        });
      } catch (e) {
        degraded.push('vector_unavailable');
        retrievalMode = 'lexical_only';
        emitSearchOps('SearchDegraded', {
          reason: 'embedding_or_vector_failed',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      retrievalMode = 'lexical_only';
      degraded.push('lexical_only_requested');
    }

    let fused = fuseHybridCandidates(lexical, vector);

    // Zero-result fallback chain (deterministic)
    if (fused.length === 0) {
      if (prepared.corrected !== prepared.expanded) {
        lexical = await this.index.lexicalSearch({
          q: prepared.corrected,
          exact: prepared.corrected,
          entityTypes,
          filters: activeFilters,
          limit: candidateLimit,
        });
        fused = fuseHybridCandidates(lexical, vector);
      }
    }
    if (fused.length === 0 && vector.length === 0 && !input.lexicalOnly) {
      try {
        const emb = await this.embedQueryCached(prepared.corrected);
        vector = await this.index.vectorSearch({
          vector: emb,
          entityTypes,
          filters: activeFilters,
          limit: candidateLimit,
        });
        fused = fuseHybridCandidates([], vector);
        if (fused.length > 0) {
          retrievalMode = 'semantic_only';
          degraded.push('lexical_empty_semantic_fallback');
        }
      } catch {
        /* already degraded */
      }
    }
    const usedPopularFallback = fused.length === 0;
    if (fused.length === 0 && !input.entityType) {
      const popular = await this.index.popular({ limit, entityType: 'collection' });
      fused = popular.map((document, i) => ({
        entityType: document.entityType,
        id: document.id,
        lexicalScore: 0,
        vectorScore: 0,
        fusionScore: 1 / (i + 1),
        document,
      }));
      if (fused.length > 0) degraded.push('popular_suggestions');
    }

    const ranked = rankCandidates(fused, laneWeights, Date.now(), prepared.corrected);
    const window = Math.min(ranked.length, Math.max(limit * 5, 50));
    const blended = blendResults(ranked, presentation, window, prepared.corrected);
    const latencyMs = Date.now() - started;

    const offset = decodeCursor(input.cursor);
    const page = blended.results.slice(offset, offset + limit);
    const nextCursor =
      offset + limit < blended.results.length ? encodeCursor(offset + limit) : null;
    const zeroResult = page.length === 0 && offset === 0;

    this.telemetry.record({
      eventType: zeroResult ? 'zero_result' : 'query',
      query: prepared.corrected,
      userId: input.userId ?? null,
      resultIds: page.map((r) => r.id),
      latencyMs,
      intent,
      retrievalMode,
      occurredAt: new Date().toISOString(),
    });

    emitSearchOps('SearchQueryServed', {
      intent,
      retrievalMode,
      hits: page.length,
      latencyMs,
      degraded,
    });

    return {
      matchingResultCount: usedPopularFallback ? 0 : page.length,
      fallbackResultCount: usedPopularFallback ? page.length : 0,
      query: prepared.corrected,
      intent,
      retrievalMode,
      presentation,
      results: page,
      lanes: blended.lanes
        ? {
            collections: blended.lanes.collections.slice(0, limit),
            creators: blended.lanes.creators.slice(0, limit),
            products: blended.lanes.products.slice(0, limit),
          }
        : undefined,
      nextCursor,
      zeroResult,
      latencyMs,
      degraded: degraded.length ? degraded : undefined,
    };
  }

  private async searchEntityPage(args: {
    input: SearchQueryInput; started: number; query: string; expanded: string;
    entityType: SearchEntityType; filters?: SearchFilters; intent: BlendedSearchResponse['intent'];
    laneWeights: ReturnType<typeof detectQueryIntent>['laneWeights']; limit: number;
    presentation: 'unified' | 'typed';
  }): Promise<BlendedSearchResponse> {
    const { input, started, query, expanded, entityType, filters, intent, laneWeights, limit, presentation } = args;
    const lexicalPage = this.index.lexicalPage!;
    const getMany = this.index.getMany!;
    const key = entityCursorKey(query, entityType, filters, input.lexicalOnly);
    const degraded: string[] = [];
    let retrievalMode: BlendedSearchResponse['retrievalMode'] = 'hybrid';
    let cursor: EntityCursor;
    let page: BlendedSearchResponse['results'];

    if (!input.cursor) {
      const headLimit = Math.max(limit, 60);
      let vector: Awaited<ReturnType<SearchIndexPort['vectorSearch']>> = [];
      let vectorError: unknown = null;
      const lexicalRequest = lexicalPage.call(this.index, { q: expanded, exact: query,
        entityType, filters, limit: headLimit });
      const vectorRequest = input.lexicalOnly ? Promise.resolve() : this.embedQueryCached(query)
        .then(embedding => this.index.vectorSearch({ vector: embedding,
          entityTypes: [entityType], filters, limit: headLimit }))
        .then(hits => { vector = hits; })
        .catch(error => { vectorError = error; });
      let [lexical] = await Promise.all([lexicalRequest, vectorRequest]);
      if (input.lexicalOnly) {
        retrievalMode = 'lexical_only';
        degraded.push('lexical_only_requested');
      } else if (vectorError) {
        retrievalMode = 'lexical_only';
        degraded.push('vector_unavailable');
        emitSearchOps('SearchDegraded', { reason: 'embedding_or_vector_failed',
          message: vectorError instanceof Error ? vectorError.message : String(vectorError) });
      }
      let fallback = false;
      if (!lexical.candidates.length && !vector.length && expanded !== query) {
        lexical = await lexicalPage.call(this.index, { q: query, exact: query, entityType, filters, limit: headLimit });
        fallback = true;
      }
      const ranked = rankCandidates(fuseHybridCandidates(lexical.candidates, vector), laneWeights, Date.now(), query);
      const ids = ranked.map(hit => hit.id);
      page = ranked.slice(0, limit).map(hit => toResultCard(hit, query));
      cursor = { v: 2, key, ids, pos: Math.min(limit, ids.length), after: lexical.after,
        hasTail: lexical.hasMore, fallback, headMode: retrievalMode === 'hybrid' ? 'hybrid' : 'lexical_only' };
    } else {
      cursor = readEntityCursor(input.cursor, key);
      retrievalMode = 'lexical_only';
      if (cursor.pos < cursor.ids.length) {
        retrievalMode = cursor.headMode;
        const ids = cursor.ids.slice(cursor.pos, cursor.pos + limit);
        const docs = await getMany.call(this.index, entityType, ids, filters);
        const byId = new Map(docs.map(doc => [doc.id, doc]));
        page = ids.flatMap(id => {
          const doc = byId.get(id);
          return doc ? [toResultCard({ entityType, id, document: doc,
            score: 0, lexicalScore: 0, vectorScore: 0 }, query)] : [];
        });
        cursor.pos += ids.length;
        if (cursor.pos === cursor.ids.length && cursor.hasTail && page.length < limit) {
          const lexical = await lexicalPage.call(this.index, { q: cursor.fallback ? query : expanded,
            exact: query, entityType, filters, limit: limit - page.length,
            after: cursor.after, excludeIds: cursor.ids });
          page.push(...lexical.candidates.map(hit => toResultCard({ ...hit, score: hit.score,
            lexicalScore: hit.score, vectorScore: 0 }, query)));
          cursor.after = lexical.after;
          cursor.hasTail = lexical.hasMore;
        }
      } else if (cursor.hasTail) {
        const lexical = await lexicalPage.call(this.index, { q: cursor.fallback ? query : expanded, exact: query,
          entityType, filters, limit, after: cursor.after, excludeIds: cursor.ids });
        page = lexical.candidates.map(hit => toResultCard({ ...hit, score: hit.score,
          lexicalScore: hit.score, vectorScore: 0 }, query));
        cursor.after = lexical.after;
        cursor.hasTail = lexical.hasMore;
      } else page = [];
    }

    const nextCursor = cursor.pos < cursor.ids.length || cursor.hasTail ? writeEntityCursor(cursor) : null;
    const latencyMs = Date.now() - started;
    this.telemetry.record({ eventType: page.length ? 'query' : 'zero_result', query,
      userId: input.userId ?? null, resultIds: page.map(r => r.id), latencyMs,
      intent, retrievalMode, occurredAt: new Date().toISOString() });
    emitSearchOps('SearchQueryServed', { intent, retrievalMode, hits: page.length, latencyMs, degraded });
    const lanes = { collections: page.filter(r => r.entityType === 'collection'),
      creators: page.filter(r => r.entityType === 'creator'), products: page.filter(r => r.entityType === 'product') };
    return { matchingResultCount: page.length, fallbackResultCount: 0, query, intent, retrievalMode,
      presentation, results: page, lanes, nextCursor, zeroResult: page.length === 0 && !input.cursor,
      latencyMs, degraded: degraded.length ? degraded : undefined };
  }

  async autocomplete(params: {
    q: string;
    userId?: string | null;
    limit?: number;
  }): Promise<AutocompleteResponse> {
    const q = prepareQuery(params.q).corrected;
    const limit = Math.min(params.limit ?? 8, 20);
    const suggestions: AutocompleteSuggestion[] = [];

    if (params.userId) {
      for (const recent of this.telemetry.recentSearches(params.userId)) {
        if (q && !recent.toLowerCase().includes(q)) continue;
        suggestions.push({ kind: 'recent', text: recent });
        if (suggestions.length >= 3) break;
      }
    }

    for (const t of this.telemetry.trendingQueries(5)) {
      if (q && !t.includes(q)) continue;
      suggestions.push({ kind: 'trending', text: t });
    }

    if (q) {
      const hits = await this.index.autocomplete({ prefix: q, limit });
      for (const h of hits) {
        suggestions.push({
          kind: h.entityType,
          text: h.text,
          id: h.id,
          entityType: h.entityType,
        });
      }
    }

    this.telemetry.record({
      eventType: 'autocomplete',
      query: q,
      userId: params.userId ?? null,
      occurredAt: new Date().toISOString(),
    });

    // dedupe by text
    const seen = new Set<string>();
    const deduped: AutocompleteSuggestion[] = [];
    for (const s of suggestions) {
      const key = s.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(s);
      if (deduped.length >= limit) break;
    }

    return { query: q, suggestions: deduped };
  }

  /**
   * Optional one-way candidate API for Recommendations.
   * Recs must NOT call back into Search as a required dependency for normal search.
   */
  async candidatesForRecommendations(params: {
    q: string;
    limit?: number;
  }): Promise<{ entityType: string; id: string; score: number }[]> {
    const res = await this.search({
      q: params.q,
      limit: params.limit ?? 50,
      presentation: 'unified',
    });
    return res.results.map((r) => ({
      entityType: r.entityType,
      id: r.id,
      score: r.score,
    }));
  }

  recordClick(params: {
    query: string;
    userId?: string | null;
    anonymousId?: string | null;
    clickedId: string;
    clickedEntityType: 'collection' | 'creator' | 'product';
  }): void {
    this.telemetry.record({
      eventType: 'click',
      userId: params.userId ?? null,
      anonymousId: params.anonymousId ?? null,
      clickedId: params.clickedId,
      clickedEntityType: params.clickedEntityType,
      occurredAt: new Date().toISOString(),
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async attachEmbedding<T extends SearchDocument>(doc: T): Promise<T> {
    try {
      const emb = await this.embeddings.embedDocuments([{ text: doc.searchableText, id: doc.id }]);
      const r = emb[0]!;
      return {
        ...doc,
        embedding: r.embedding,
        embeddingModelId: r.modelId,
        embeddingVersion: r.version,
        embeddingDimension: r.dimension,
      };
    } catch (e) {
      // Index lexically even if embedding fails
      emitSearchOps('SearchDegraded', {
        reason: 'embed_document_failed',
        id: doc.id,
        message: e instanceof EmbeddingError ? e.message : String(e),
      });
      return doc;
    }
  }

  private async embedQueryCached(normalizedQuery: string): Promise<number[]> {
    const key = `${this.embeddings.modelId}:${this.embeddings.version}:${this.embeddings.dimension}:${normalizedQuery}`;
    const hit = this.queryEmbedCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      this.queryEmbedCache.delete(key);
      this.queryEmbedCache.set(key, hit);
      return hit.embedding;
    }
    this.queryEmbedCache.delete(key);
    const inFlight = this.queryEmbedInFlight.get(key);
    if (inFlight) return inFlight;
    const pending = this.embeddings.embedQuery(normalizedQuery).then(result => {
      this.queryEmbedCache.set(key, { embedding: result.embedding,
        expiresAt: Date.now() + this.queryEmbedTtlMs });
      while (this.queryEmbedCache.size > this.queryEmbedMaxEntries) {
        const oldest = this.queryEmbedCache.keys().next().value;
        if (!oldest) break;
        this.queryEmbedCache.delete(oldest);
      }
      return result.embedding;
    }).finally(() => { this.queryEmbedInFlight.delete(key); });
    this.queryEmbedInFlight.set(key, pending);
    return pending;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      o?: number;
    };
    return typeof parsed.o === 'number' && parsed.o >= 0 ? parsed.o : 0;
  } catch {
    return 0;
  }
}
