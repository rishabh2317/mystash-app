import type { LexicalCandidate, SearchIndexPort, VectorCandidate } from '../ports';
import type { SearchDocument, SearchEntityType, SearchFilters } from '../domain/types';
import {
  EmbeddingSpaceMismatchError,
  type EmbeddingSpace,
} from './OpenSearchIndex';

function docKey(entityType: SearchEntityType, id: string): string {
  return `${entityType}:${id}`;
}

function passesFilters(doc: SearchDocument, filters?: SearchFilters): boolean {
  if (!filters) return true;
  if (!doc.searchEligible || doc.deleted) return false;
  if (filters.creatorId) {
    if (doc.entityType === 'collection' && doc.creator.creatorId !== filters.creatorId) return false;
    if (doc.entityType === 'creator' && doc.userId !== filters.creatorId) return false;
    if (doc.entityType === 'product') return false;
  }
  if (filters.brand) {
    const b = filters.brand.toLowerCase();
    if (doc.entityType === 'collection') {
      if (!doc.searchBrands.some((x) => x.toLowerCase() === b)) return false;
    } else if (doc.entityType === 'product') {
      if ((doc.brand ?? '').toLowerCase() !== b) return false;
    } else return false;
  }
  if (filters.category) {
    const c = filters.category.toLowerCase();
    if (doc.entityType === 'collection') {
      if (!doc.searchCategories.some((x) => x.toLowerCase() === c)) return false;
    } else if (doc.entityType === 'product') {
      if ((doc.category ?? '').toLowerCase() !== c) return false;
    } else return false;
  }
  if (filters.verifiedOnly && doc.entityType === 'product') {
    const v = (doc.verificationStatus ?? '').toLowerCase();
    if (v !== 'verified' && v !== 'high') return false;
  }
  if (filters.recentlyPublished && doc.entityType === 'collection') {
    if (!doc.publishedAt) return false;
    const age = Date.now() - Date.parse(doc.publishedAt);
    if (age > 30 * 86_400_000) return false;
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

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Simple BM25-ish lexical score over searchableText + weighted title fields. */
function lexicalScore(doc: SearchDocument, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const text = doc.searchableText.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (text.includes(t)) score += 1;
    // prefix boost for autocomplete-ish lexical
    if (text.split(/\s+/).some((w) => w.startsWith(t))) score += 0.35;
  }
  if (doc.entityType === 'collection' && doc.searchTitle) {
    const title = doc.searchTitle.toLowerCase();
    for (const t of tokens) if (title.includes(t)) score += 1.5;
  }
  if (doc.entityType === 'creator') {
    const u = doc.username.toLowerCase();
    const n = (doc.displayName ?? '').toLowerCase();
    for (const t of tokens) {
      if (u.includes(t)) score += 2;
      if (n.includes(t)) score += 1.5;
    }
  }
  if (doc.entityType === 'product') {
    const name = doc.name.toLowerCase();
    for (const t of tokens) if (name.includes(t)) score += 2;
    if (doc.brand) {
      const b = doc.brand.toLowerCase();
      for (const t of tokens) if (b.includes(t)) score += 1.5;
    }
  }
  return score;
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/**
 * In-memory Search index — used for unit tests and explicit local zero-infra
 * (SEARCH_INDEX_BACKEND=memory). Implements the same SearchIndexPort as OpenSearchIndex.
 * Not a production OpenSearch substitute when SEARCH_ENV/NODE_ENV is production.
 */
export class InMemorySearchIndex implements SearchIndexPort {
  private docs = new Map<string, SearchDocument>();
  private readonly embeddingSpace: EmbeddingSpace | null;

  constructor(opts?: { embeddingSpace?: EmbeddingSpace | null }) {
    this.embeddingSpace = opts?.embeddingSpace ?? null;
  }

  private assertEmbeddingSpace(doc: SearchDocument): void {
    if (!this.embeddingSpace || !doc.embedding?.length) return;
    const s = this.embeddingSpace;
    if (
      doc.embeddingModelId !== s.embeddingModelId ||
      doc.embeddingVersion !== s.embeddingVersion ||
      doc.embeddingDimension !== s.embeddingDimension ||
      doc.embedding.length !== s.embeddingDimension
    ) {
      throw new EmbeddingSpaceMismatchError(
        `Embedding space mismatch for ${doc.entityType}:${doc.id}`,
      );
    }
  }

  async upsert(doc: SearchDocument): Promise<void> {
    if (doc.deleted || !doc.searchEligible) {
      this.docs.delete(docKey(doc.entityType, doc.id));
      return;
    }
    this.assertEmbeddingSpace(doc);
    this.docs.set(docKey(doc.entityType, doc.id), { ...doc, indexedAt: new Date().toISOString() });
  }

  async upsertMany(docs: SearchDocument[]): Promise<void> {
    for (const d of docs) await this.upsert(d);
  }

  async delete(entityType: SearchEntityType, id: string): Promise<void> {
    this.docs.delete(docKey(entityType, id));
  }

  async get(entityType: SearchEntityType, id: string): Promise<SearchDocument | null> {
    return this.docs.get(docKey(entityType, id)) ?? null;
  }

  /** Test/helper */
  size(): number {
    return this.docs.size;
  }

  async lexicalSearch(params: {
    q: string;
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<LexicalCandidate[]> {
    const tokens = tokenize(params.q);
    const types = new Set(params.entityTypes ?? ['collection', 'creator', 'product']);
    const hits: LexicalCandidate[] = [];
    for (const doc of this.docs.values()) {
      if (!types.has(doc.entityType)) continue;
      if (!passesFilters(doc, params.filters)) continue;
      const score = lexicalScore(doc, tokens);
      if (score <= 0) continue;
      hits.push({ entityType: doc.entityType, id: doc.id, score, document: doc });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, params.limit);
  }

  async vectorSearch(params: {
    vector: number[];
    entityTypes?: SearchEntityType[];
    filters?: SearchFilters;
    limit: number;
  }): Promise<VectorCandidate[]> {
    const types = new Set(params.entityTypes ?? ['collection', 'creator', 'product']);
    const hits: VectorCandidate[] = [];
    for (const doc of this.docs.values()) {
      if (!types.has(doc.entityType)) continue;
      if (!passesFilters(doc, params.filters)) continue;
      if (!doc.embedding || doc.embedding.length === 0) continue;
      const score = cosine(params.vector, doc.embedding);
      if (score < 0.05) continue;
      hits.push({ entityType: doc.entityType, id: doc.id, score, document: doc });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, params.limit);
  }

  async autocomplete(params: {
    prefix: string;
    limit: number;
  }): Promise<Array<{ text: string; id: string; entityType: SearchEntityType }>> {
    const p = params.prefix.toLowerCase().trim();
    if (!p) return [];
    const out: Array<{ text: string; id: string; entityType: SearchEntityType; pop: number }> = [];
    for (const doc of this.docs.values()) {
      if (!doc.searchEligible || doc.deleted) continue;
      let text = '';
      let pop = 0;
      if (doc.entityType === 'collection') {
        text = doc.searchTitle ?? doc.slug;
        pop = doc.savesCount + doc.viewsCount;
      } else if (doc.entityType === 'creator') {
        text = doc.displayName ?? doc.username;
        pop = doc.followersCount;
      } else {
        text = doc.name;
        pop = doc.popularity;
      }
      if (!text.toLowerCase().startsWith(p) && !text.toLowerCase().includes(p)) continue;
      out.push({ text, id: doc.id, entityType: doc.entityType, pop });
    }
    out.sort((a, b) => b.pop - a.pop);
    return out.slice(0, params.limit).map(({ text, id, entityType }) => ({ text, id, entityType }));
  }

  async popular(params: {
    limit: number;
    entityType?: SearchEntityType;
  }): Promise<SearchDocument[]> {
    const docs = [...this.docs.values()].filter((d) => {
      if (!d.searchEligible || d.deleted) return false;
      if (params.entityType && d.entityType !== params.entityType) return false;
      return true;
    });
    docs.sort((a, b) => popularity(b) - popularity(a));
    return docs.slice(0, params.limit);
  }
}

function popularity(d: SearchDocument): number {
  if (d.entityType === 'collection') return d.savesCount * 3 + d.viewsCount;
  if (d.entityType === 'creator') return d.followersCount;
  return d.popularity;
}
