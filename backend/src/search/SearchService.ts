import { EmbeddingError, type EmbeddingPort } from './embeddings/EmbeddingPort';
import { fuseHybridCandidates } from './domain/hybrid';
import { detectQueryIntent } from './domain/intent';
import { prepareQuery } from './domain/queryPrep';
import { blendResults, rankCandidates } from './domain/ranking';
import type {
  AutocompleteResponse,
  AutocompleteSuggestion,
  BlendedSearchResponse,
  SearchDocument,
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

/**
 * Search application boundary — indexing, hybrid retrieval, deterministic ranking/blend.
 * OpenSearch (or in-memory) = retrieval infra; this service owns product relevance semantics.
 */
export class SearchService {
  private readonly queryEmbedCache = new Map<string, QueryEmbedCacheEntry>();
  private readonly queryEmbedTtlMs = 10 * 60_000;

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
    const prepared = prepareQuery(input.q ?? '');
    if (!prepared.normalized) {
      throw new SearchServiceError('q required', 400);
    }

    const { intent, laneWeights } = detectQueryIntent(prepared.corrected);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const presentation = input.presentation ?? 'unified';
    const degraded: string[] = [];
    let retrievalMode: BlendedSearchResponse['retrievalMode'] = 'hybrid';

    const candidateLimit = Math.max(limit * 3, 40);

    let lexical = await this.index.lexicalSearch({
      q: prepared.expanded,
      filters: input.filters,
      limit: candidateLimit,
    });

    let vector: Awaited<ReturnType<SearchIndexPort['vectorSearch']>> = [];
    if (!input.lexicalOnly) {
      try {
        const emb = await this.embedQueryCached(prepared.corrected);
        vector = await this.index.vectorSearch({
          vector: emb,
          filters: input.filters,
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
          filters: input.filters,
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
          filters: input.filters,
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
    if (fused.length === 0) {
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

    const ranked = rankCandidates(fused, laneWeights);
    const window = Math.min(ranked.length, Math.max(limit * 5, 50));
    const blended = blendResults(ranked, presentation, window);
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
  }): Promise<Array<{ entityType: string; id: string; score: number }>> {
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
      query: params.query,
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
    if (hit && hit.expiresAt > Date.now()) return hit.embedding;
    const r = await this.embeddings.embedQuery(normalizedQuery);
    this.queryEmbedCache.set(key, {
      embedding: r.embedding,
      expiresAt: Date.now() + this.queryEmbedTtlMs,
    });
    return r.embedding;
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
