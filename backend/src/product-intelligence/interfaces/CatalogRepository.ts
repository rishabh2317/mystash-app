import type {
  CatalogProduct,
  CreateCatalogInput,
  SearchCandidate,
  UpdateCatalogInput,
  VerificationStatus,
} from '../domain/types';

export type LocalSearchQuery = {
  normalizedName: string;
  brand: string | null;
  model: string | null;
  merchantUrl?: string | null;
  aliases?: string[];
};

export type LocalSearchHit = {
  product: CatalogProduct;
  score: number;
  via: 'exact_name' | 'alias' | 'brand_model' | 'fuzzy' | 'merchant_url';
};

export type CatalogRepository = {
  findByNormalizedName(normalizedName: string): Promise<CatalogProduct[]>;
  findByAlias(alias: string): Promise<CatalogProduct[]>;
  findByBrandModel(brand: string, model: string): Promise<CatalogProduct[]>;
  findByMerchantUrl(merchantUrl: string): Promise<CatalogProduct | null>;
  findBySlug(slug: string): Promise<CatalogProduct | null>;
  findById(id: string): Promise<CatalogProduct | null>;
  create(input: CreateCatalogInput): Promise<CatalogProduct>;
  /** Background enrichment updates the existing catalog record in place. */
  update(id: string, patch: UpdateCatalogInput): Promise<CatalogProduct>;
  addAlias(catalogProductId: string, alias: string): Promise<void>;
  listActiveForFuzzy(limit?: number): Promise<CatalogProduct[]>;
};

export type SearchCandidateCache = {
  get(query: string, provider: string): Promise<SearchCandidate[] | null>;
  set(query: string, provider: string, candidates: SearchCandidate[], ttlMs: number): Promise<void>;
};

export type MatchHistoryWriter = {
  write(row: {
    draftId: string;
    catalogProductId: string | null;
    score: number | null;
    decision: string;
    reason: string;
    aiConfidence?: number | null;
    matchConfidence?: number | null;
    verificationConfidence?: number | null;
  }): Promise<void>;
};

export type DraftResolutionUpdate = {
  draftId: string;
  catalogProductId: string | null;
  resolutionStatus: VerificationStatus;
  merchantUrl: string | null;
  affiliateUrl: string | null;
  aiConfidence: number;
  matchConfidence: number | null;
  /** Optional Review-facing fields from Tavily / catalog enrichment. */
  displayName?: string | null;
  displayImage?: string | null;
  displayPrice?: string | null;
  displayCurrency?: string | null;
  displayProvider?: string | null;
  displayBrand?: string | null;
};

export type DraftUpdater = {
  updateResolution(update: DraftResolutionUpdate): Promise<void>;
};
