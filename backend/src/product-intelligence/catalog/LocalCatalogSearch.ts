import type { CatalogProduct, NormalizedProduct } from '../domain/types';
import type { CatalogRepository, LocalSearchHit } from '../interfaces/CatalogRepository';
import { sortPreferVerified } from './SupabaseCatalogRepository';

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\s+/).filter(Boolean));
}

function compatible(norm: NormalizedProduct, candidate: CatalogProduct): boolean {
  if (
    norm.normalizedBrand &&
    candidate.brand &&
    candidate.brand.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() !== norm.normalizedBrand
  ) {
    return false;
  }
  if (norm.model && candidate.model && candidate.model.toLowerCase() !== norm.model.toLowerCase()) {
    return false;
  }
  if (
    norm.category !== 'unknown' &&
    candidate.category &&
    candidate.category !== 'unknown' &&
    candidate.category.toLowerCase() !== norm.category.toLowerCase()
  ) {
    return false;
  }
  return true;
}

/** Dice coefficient on token sets (0–1). */
export function fuzzyScore(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Local catalog search: exact → alias → brand+model → fuzzy → merchant URL.
 * Prefer VERIFIED over UNVERIFIED within each step.
 */
export class LocalCatalogSearch {
  constructor(private readonly repo: CatalogRepository) {}

  async search(norm: NormalizedProduct): Promise<LocalSearchHit | null> {
    if (norm.merchantUrlHint) {
      const byUrl = await this.repo.findByMerchantUrl(norm.merchantUrlHint);
      if (byUrl) return { product: byUrl, score: 1, via: 'merchant_url' };
    }

    const exact = await this.repo.findByNormalizedName(norm.normalizedName);
    const exactCompatible = exact.find((p) => compatible(norm, p));
    if (exactCompatible) return { product: exactCompatible, score: 1, via: 'exact_name' };

    for (const alias of norm.aliases) {
      const hits = await this.repo.findByAlias(alias);
      const hit = hits.find((p) => compatible(norm, p));
      if (hit) return { product: hit, score: 0.95, via: 'alias' };
    }

    if (norm.brand && norm.model) {
      const bm = await this.repo.findByBrandModel(norm.brand, norm.model);
      if (bm[0]) return { product: bm[0]!, score: 0.92, via: 'brand_model' };
    }

    const pool = sortPreferVerified(await this.repo.listActiveForFuzzy(300));
    let best: LocalSearchHit | null = null;
    for (const p of pool) {
      if (!compatible(norm, p)) continue;
      const s = fuzzyScore(norm.normalizedName, p.normalizedName);
      if (s < 0.72) continue;
      if (!best || s > best.score || (s === best.score && p.verificationStatus === 'VERIFIED')) {
        best = { product: p, score: s, via: 'fuzzy' };
      }
    }
    return best;
  }
}
