/** Provider-agnostic domain types for Product Intelligence. */

export type CatalogStatus = 'ACTIVE' | 'DISCONTINUED' | 'MERGED' | 'HIDDEN';

export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';

export type SearchFailureKind = 'quota' | 'timeout' | 'network' | 'auth' | 'unknown';

export type NormalizedProduct = {
  name: string;
  brand: string | null;
  model: string | null;
  category: string;
  normalizedName: string;
  normalizedBrand: string | null;
  canonicalSlugBase: string;
  aliases: string[];
  aiConfidence: number;
  merchantUrlHint?: string | null;
  imageHint?: string | null;
  priceHint?: string | null;
  currencyHint?: string | null;
};

/** Normalized search hit — never Google/Serper-specific fields. */
export type SearchCandidate = {
  merchant: string | null;
  merchantUrl: string;
  title: string;
  image: string | null;
  score: number;
  snippet?: string | null;
  pdpScore?: number;
  pdpVerdict?: 'pdp' | 'not_pdp' | 'uncertain';
  pdpReasons?: string[];
  sourceTier?: 'official' | 'marketplace' | 'retailer' | 'editorial';
  enrichmentSucceeded?: boolean;
  /** Optional enrichment (e.g. MerchantEnrichmentService / Tavily) — ignored by discovery-only providers. */
  brand?: string | null;
  description?: string | null;
  price?: string | null;
  currency?: string | null;
  /** Extra catalog metadata (specs, completeness) — merged into catalog.metadata without schema change. */
  enrichmentMeta?: Record<string, unknown>;
};

export type SearchSucceeded = {
  kind: 'Succeeded';
  candidates: SearchCandidate[];
  provider: string;
};

export type SearchFailed = {
  kind: 'Failed';
  errorKind: SearchFailureKind;
  message: string;
  provider: string;
};

export type SearchResult = SearchSucceeded | SearchFailed;

export type CatalogProduct = {
  id: string;
  canonicalSlug: string;
  brand: string | null;
  name: string;
  normalizedName: string;
  model: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  merchant: string | null;
  merchantUrl: string | null;
  affiliateUrl: string | null;
  currency: string | null;
  price: string | null;
  status: CatalogStatus;
  verificationStatus: VerificationStatus;
  verificationSource: string | null;
  verificationVersion: string | null;
  lastVerifiedAt: string | null;
  aiConfidence: number | null;
  matchConfidence: number | null;
  verificationConfidence: number | null;
  mergedIntoId: string | null;
  metadata: Record<string, unknown>;
};

export type MatchScoreResult = {
  score: number;
  reason: string;
  matchConfidence: number;
};

export type CreateCatalogInput = {
  name: string;
  normalizedName: string;
  canonicalSlug: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  description?: string | null;
  imageUrl?: string | null;
  merchant?: string | null;
  merchantUrl?: string | null;
  affiliateUrl?: string | null;
  currency?: string | null;
  price?: string | null;
  verificationStatus: VerificationStatus;
  verificationSource: string;
  verificationVersion: string;
  aiConfidence?: number | null;
  matchConfidence?: number | null;
  verificationConfidence?: number | null;
  aliases?: string[];
  metadata?: Record<string, unknown>;
};

/** In-place patch for background enrichment (never creates duplicates). */
export type UpdateCatalogInput = {
  name?: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  merchant?: string | null;
  merchantUrl?: string | null;
  affiliateUrl?: string | null;
  currency?: string | null;
  price?: string | null;
  availability?: string | null;
  verificationStatus?: VerificationStatus;
  verificationSource?: string | null;
  verificationVersion?: string | null;
  aiConfidence?: number | null;
  matchConfidence?: number | null;
  verificationConfidence?: number | null;
  metadata?: Record<string, unknown>;
  lastVerifiedAt?: string | null;
};

export type AiDraftInput = {
  draftId: string;
  externalId: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  confidence: number;
  merchantUrl?: string | null;
  image?: string | null;
  price?: string | null;
  currency?: string | null;
  /** When set, enrichment updates this catalog row in place. */
  catalogProductId?: string | null;
  sources?: string[];
  evidence?: Record<string, unknown> | null;
  reasoning?: string | null;
  videoTitle?: string | null;
};

export type ResolveDraftResult = {
  draftId: string;
  resolutionStatus: VerificationStatus;
  catalogProductId: string | null;
  merchantUrl: string | null;
  affiliateUrl: string | null;
  aiConfidence: number;
  matchConfidence: number | null;
  decision: string;
  reason: string;
  enqueueBackground: boolean;
  specificityScore?: number;
  pdpClassifierScore?: number | null;
};
