import type { ProductAiReviewRecord } from './domain/types';

export type ClaimGenerationResult =
  | { claimed: true; record: ProductAiReviewRecord }
  | { claimed: false; record: ProductAiReviewRecord | null };

export type UpsertReadyInput = {
  productId: string;
  summary: string;
  pros: ProductAiReviewRecord['pros'];
  cons: ProductAiReviewRecord['cons'];
  sources: ProductAiReviewRecord['sources'];
  evidenceLastCheckedAt: string;
  summaryGeneratedAt: string;
  evidenceHash: string;
  model: string;
};

export type MarkUnavailableInput = {
  productId: string;
  errorCode: string;
  errorMessage: string;
  evidenceHash: string | null;
  evidenceLastCheckedAt: string;
};

export type MarkFailedInput = {
  productId: string;
  errorCode: string;
  errorMessage: string;
};

export type MarkRefreshFailedInput = {
  productId: string;
  refreshErrorCode: string;
  refreshFailedAt: string;
  refreshNextRetryAt: string;
};

export interface ProductAiReviewRepository {
  findByProductId(productId: string): Promise<ProductAiReviewRecord | null>;
  claimGeneration(productId: string, evidenceHash: string, model: string): Promise<ClaimGenerationResult>;
  markReady(input: UpsertReadyInput): Promise<ProductAiReviewRecord>;
  markUnavailable(input: MarkUnavailableInput): Promise<ProductAiReviewRecord>;
  markFailed(input: MarkFailedInput): Promise<ProductAiReviewRecord>;
  markRefreshFailed(input: MarkRefreshFailedInput): Promise<ProductAiReviewRecord>;
}
