import { getEnv } from '../env';

function num(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export type ProductSearchProviderId = 'serper' | 'google_cse';

export type ProductIntelligenceConfig = {
  enabled: boolean;
  catalogHitMinScore: number;
  catalogMatchEpsilon: number;
  specificityMin: number;
  verificationMatchMin: number;
  pdpClassifierMin: number;
  searchCacheTtlMs: number;
  affiliateCacheTtlMs: number;
  backgroundResolve: boolean;
  /** Max trusted PDPs to enrich per draft (cost control). */
  metadataEnrichMaxCandidates: number;
  /** Default product web search provider (DI can override). */
  searchProvider: ProductSearchProviderId;
  serperApiKey: string | null;
  googleCseApiKey: string | null;
  googleCseId: string | null;
  verificationVersion: string;
};

function parseSearchProvider(raw: string | undefined): ProductSearchProviderId {
  const v = (raw ?? 'serper').trim().toLowerCase();
  if (v === 'google_cse' || v === 'google' || v === 'cse') return 'google_cse';
  return 'serper';
}

export function getProductIntelligenceConfig(): ProductIntelligenceConfig {
  return {
    enabled: (getEnv('PRODUCT_INTELLIGENCE_ENABLED') ?? 'true').toLowerCase() !== 'false',
    catalogHitMinScore: num('CATALOG_HIT_MIN_SCORE', 0.85),
    catalogMatchEpsilon: num('CATALOG_MATCH_EPSILON', 0.05),
    specificityMin: num('PRODUCT_SPECIFICITY_MIN', 0.55),
    verificationMatchMin: num('PRODUCT_VERIFICATION_MATCH_MIN', 0.45),
    pdpClassifierMin: num('PDP_CLASSIFIER_MIN_SCORE', 0.45),
    searchCacheTtlMs: num('SEARCH_CACHE_TTL_HOURS', 168) * 3600_000,
    affiliateCacheTtlMs: num('AFFILIATE_CACHE_TTL_DAYS', 30) * 24 * 3600_000,
    backgroundResolve: (getEnv('PRODUCT_RESOLVE_BACKGROUND') ?? 'true').toLowerCase() !== 'false',
    metadataEnrichMaxCandidates: Math.max(1, Math.min(10, num('METADATA_ENRICH_MAX_CANDIDATES', 5))),
    searchProvider: parseSearchProvider(getEnv('PRODUCT_SEARCH_PROVIDER')),
    serperApiKey: getEnv('SERPER_API_KEY')?.trim() || null,
    googleCseApiKey: getEnv('GOOGLE_CSE_API_KEY')?.trim() || null,
    googleCseId: getEnv('GOOGLE_CSE_ID')?.trim() || null,
    verificationVersion: getEnv('CATALOG_VERIFICATION_VERSION')?.trim() || 'v1',
  };
}
