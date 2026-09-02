/** Attribution for a summarized review point (major editorial / review publisher). */
export type ProductAiReviewSource = {
  name: string;
  url: string;
};

export type ProductAiReviewSummary = {
  catalogProductId: string;
  /** Concise decision-oriented overview from backend research. */
  overview?: string | null;
  pros: string[];
  cons: string[];
  sources: ProductAiReviewSource[];
  /** ISO timestamp when the summary was last refreshed, if known. */
  updatedAt?: string | null;
  /** ISO timestamp when web evidence was last checked, if known. */
  evidenceLastCheckedAt?: string | null;
};

export type ProductAiReviewUnavailable = {
  status: 'unavailable';
  catalogProductId: string;
  reason:
    | 'missing_product_id'
    | 'not_yet_available'
    | 'fetch_failed'
    | 'network_error'
    | 'invalid_response'
    | 'insufficient_evidence'
    | 'validation_failed'
    | 'server_error'
    | 'config_missing'
    | 'api_error'
    | 'timeout';
  message: string;
  retryEligible?: boolean;
};

export type ProductAiReviewGenerating = {
  status: 'generating';
  catalogProductId: string;
  message: string;
};

export type ProductAiReviewAvailable = {
  status: 'available';
  summary: ProductAiReviewSummary;
};

export type ProductAiReviewResult =
  | ProductAiReviewAvailable
  | ProductAiReviewUnavailable
  | ProductAiReviewGenerating;
