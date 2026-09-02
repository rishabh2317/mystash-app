import type { RankedHit, SearchEntityType, SearchResultCard } from './types';
import type { HybridCandidate } from '../ports';

export type LaneWeights = { collection: number; creator: number; product: number };


/**
 * Deterministic ranking over hybrid candidates.
 * OpenSearch may assist with lexical/vector/fusion scores;
 * Mystash owns Collection-first + business-signal combination.
 */
export function rankCandidates(
  candidates: HybridCandidate[],
  laneWeights: LaneWeights,
  nowMs = Date.now(),
): RankedHit[] {
  const ranked = candidates.map((c) => {
    const doc = c.document;
    const entityBoost = laneWeights[entityKey(c.entityType)] ?? 0.3;
    const freshness = freshnessBoost(doc, nowMs);
    const engagement = engagementBoost(doc);
    const quality = qualityBoost(doc);
    const verification = verificationBoost(doc);
    const authority = authorityBoost(doc);

    const score =
      0.42 * c.fusionScore +
      0.18 * entityBoost +
      0.12 * freshness +
      0.12 * engagement +
      0.08 * quality +
      0.05 * verification +
      0.03 * authority;

    return {
      entityType: c.entityType,
      id: c.id,
      score,
      lexicalScore: c.lexicalScore,
      vectorScore: c.vectorScore,
      document: doc,
    } satisfies RankedHit;
  });

  ranked.sort((a, b) => b.score - a.score);
  return diversifyCreators(ranked);
}

function entityKey(t: SearchEntityType): keyof LaneWeights {
  if (t === 'collection') return 'collection';
  if (t === 'creator') return 'creator';
  return 'product';
}

function freshnessBoost(doc: HybridCandidate['document'], nowMs: number): number {
  if (doc.entityType !== 'collection' || !doc.publishedAt) return 0.3;
  const ageDays = (nowMs - Date.parse(doc.publishedAt)) / 86_400_000;
  if (Number.isNaN(ageDays)) return 0.3;
  if (ageDays < 7) return 1;
  if (ageDays < 30) return 0.75;
  if (ageDays < 180) return 0.45;
  return 0.2;
}

function engagementBoost(doc: HybridCandidate['document']): number {
  if (doc.entityType === 'collection') {
    const saves = doc.savesCount ?? 0;
    const views = doc.viewsCount ?? 0;
    const clicks = doc.productClicksCount ?? 0;
    return Math.min(1, Math.log10(2 + saves * 3 + clicks * 2 + views * 0.1) / 4);
  }
  if (doc.entityType === 'creator') {
    return Math.min(1, Math.log10(2 + doc.followersCount) / 5);
  }
  return Math.min(1, Math.log10(2 + doc.popularity) / 4);
}

function qualityBoost(doc: HybridCandidate['document']): number {
  if (doc.entityType === 'collection' && doc.qualityScore != null) {
    return Math.max(0, Math.min(1, doc.qualityScore));
  }
  return 0.4;
}

function verificationBoost(doc: HybridCandidate['document']): number {
  if (doc.entityType === 'product') {
    const v = (doc.verificationStatus ?? '').toLowerCase();
    if (v === 'verified' || v === 'high') return 1;
    if (v === 'partial' || v === 'medium') return 0.6;
    return 0.3;
  }
  return 0.4;
}

function authorityBoost(doc: HybridCandidate['document']): number {
  if (doc.entityType === 'collection') return Math.min(1, doc.creatorAuthority / 100);
  if (doc.entityType === 'creator') return Math.min(1, doc.creatorAuthority / 100);
  return 0.3;
}

/** Reduce creator domination in Collection results. */
function diversifyCreators(hits: RankedHit[]): RankedHit[] {
  const seenCreators = new Map<string, number>();
  const out: RankedHit[] = [];
  for (const h of hits) {
    if (h.entityType === 'collection' && h.document.entityType === 'collection') {
      const cid = h.document.creator.creatorId;
      const n = seenCreators.get(cid) ?? 0;
      if (n >= 3) continue;
      seenCreators.set(cid, n + 1);
    }
    out.push(h);
  }
  return out;
}

function formatIndexPrice(amount: number | null, currency: string | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (currency?.trim()) return `${currency.trim()} ${amount}`;
  return String(amount);
}

/** Deterministic one-line hint from indexed fields + query tokens. */
export function buildMatchReason(
  hit: RankedHit,
  query: string,
): string | null {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;

  const d = hit.document;
  if (d.entityType === 'collection') {
    const brand = d.searchBrands.find((b) =>
      tokens.some((t) => b.toLowerCase().includes(t) || t.includes(b.toLowerCase())),
    );
    if (brand) return `Matches brand ${brand}`;
    const category = d.searchCategories.find((c) =>
      tokens.some((t) => c.toLowerCase().includes(t) || t.includes(c.toLowerCase())),
    );
    if (category) return `In ${category}`;
    if (d.productTagCount > 0) return `${d.productTagCount} products inside`;
    return null;
  }
  if (d.entityType === 'product') {
    const brand = d.brand?.toLowerCase() ?? '';
    if (brand && tokens.some((t) => brand.includes(t) || t.includes(brand))) {
      return d.brand ? `Brand: ${d.brand}` : null;
    }
    const category = d.category?.toLowerCase() ?? '';
    if (category && tokens.some((t) => category.includes(t) || t.includes(category))) {
      return d.category ? `Category: ${d.category}` : null;
    }
    return null;
  }
  if (d.entityType === 'creator') {
    if (d.followersCount > 0) return `${d.followersCount} followers`;
  }
  return null;
}

export function toResultCard(hit: RankedHit, query = ''): SearchResultCard {
  const d = hit.document;
  const matchReason = buildMatchReason(hit, query);
  if (d.entityType === 'collection') {
    return {
      entityType: 'collection',
      id: d.collectionId,
      score: hit.score,
      title: d.searchTitle ?? d.slug,
      subtitle: d.creator.displayName ?? d.creator.username,
      imageRef: d.primaryMediaRef,
      slug: d.slug,
      primaryMediaRef: d.primaryMediaRef,
      creator: d.creator,
      productTagCount: d.productTagCount,
      viewsCount: d.viewsCount,
      savesCount: d.savesCount,
      matchReason,
    };
  }
  if (d.entityType === 'creator') {
    return {
      entityType: 'creator',
      id: d.userId,
      score: hit.score,
      title: d.displayName ?? d.username,
      subtitle: `@${d.username}`,
      imageRef: d.avatarRef,
      username: d.username,
      followersCount: d.followersCount,
      matchReason,
    };
  }
  return {
    entityType: 'product',
    id: d.catalogProductId,
    score: hit.score,
    title: d.name,
    subtitle: [d.brand, d.model].filter(Boolean).join(' · ') || null,
    imageRef: d.primaryImageRef,
    verificationStatus: d.verificationStatus,
    price: formatIndexPrice(d.priceAmount, d.priceCurrency),
    priceCurrency: d.priceCurrency,
    matchReason,
  };
}

export function blendResults(
  ranked: RankedHit[],
  presentation: 'unified' | 'typed',
  limit: number,
  query = '',
): {
  results: SearchResultCard[];
  lanes?: {
    collections: SearchResultCard[];
    creators: SearchResultCard[];
    products: SearchResultCard[];
  };
} {
  const cards = ranked.map((hit) => toResultCard(hit, query));
  const lanes = {
    collections: cards.filter((c) => c.entityType === 'collection'),
    creators: cards.filter((c) => c.entityType === 'creator'),
    products: cards.filter((c) => c.entityType === 'product'),
  };
  if (presentation === 'typed') {
    return {
      results: [
        ...lanes.collections.slice(0, Math.ceil(limit * 0.5)),
        ...lanes.creators.slice(0, Math.ceil(limit * 0.25)),
        ...lanes.products.slice(0, Math.ceil(limit * 0.25)),
      ].slice(0, limit),
      lanes: {
        collections: lanes.collections.slice(0, limit),
        creators: lanes.creators.slice(0, limit),
        products: lanes.products.slice(0, limit),
      },
    };
  }
  return { results: cards.slice(0, limit), lanes };
}
