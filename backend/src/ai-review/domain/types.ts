import type { CatalogProduct } from '../../product-intelligence/domain/types';

export type ProductAiReviewStatus = 'READY' | 'GENERATING' | 'UNAVAILABLE' | 'FAILED';

export type ProductAiReviewSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
};

export type ProductAiReviewEvidenceClaim = {
  sourceId: string;
  claim: string;
};

export type ProductAiReviewPoint = {
  text: string;
  evidence: ProductAiReviewEvidenceClaim[];
};

export type ProductAiReviewGeneratedPayload = {
  summary: string;
  pros: ProductAiReviewPoint[];
  cons: ProductAiReviewPoint[];
  sources: ProductAiReviewSource[];
  generatedAt: string;
  evidenceLastCheckedAt: string;
};

export type ProductAiReviewRecord = {
  id: string;
  productId: string;
  status: ProductAiReviewStatus;
  summary: string | null;
  pros: ProductAiReviewPoint[];
  cons: ProductAiReviewPoint[];
  sources: ProductAiReviewSource[];
  evidenceLastCheckedAt: string | null;
  summaryGeneratedAt: string | null;
  evidenceHash: string | null;
  model: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  refreshErrorCode: string | null;
  refreshFailedAt: string | null;
  refreshNextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductAiReviewApiAvailable = {
  status: 'available';
  catalogProductId: string;
  summary: string;
  pros: string[];
  cons: string[];
  sources: Array<{ name: string; url: string }>;
  updatedAt: string;
  evidenceLastCheckedAt: string;
};

export type ProductAiReviewApiGenerating = {
  status: 'generating';
  catalogProductId: string;
  message: string;
};

export type ProductAiReviewApiUnavailable = {
  status: 'unavailable';
  catalogProductId: string;
  reason: string;
  message: string;
  retryEligible?: boolean;
};

export type ProductAiReviewApiResponse =
  | ProductAiReviewApiAvailable
  | ProductAiReviewApiGenerating
  | ProductAiReviewApiUnavailable;

export type ProductIdentityContext = {
  productId: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  canonicalSlug: string;
  specifications: Record<string, string>;
};

export function productIdentityFromCatalog(product: CatalogProduct): ProductIdentityContext {
  const specsRaw = product.metadata?.specifications;
  const specifications: Record<string, string> = {};
  if (specsRaw && typeof specsRaw === 'object' && !Array.isArray(specsRaw)) {
    for (const [k, v] of Object.entries(specsRaw as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) specifications[k] = v.trim();
    }
  }
  return {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    model: product.model,
    category: product.category,
    canonicalSlug: product.canonicalSlug,
    specifications,
  };
}
