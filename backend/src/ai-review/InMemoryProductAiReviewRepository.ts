import type {
  ClaimGenerationResult,
  MarkFailedInput,
  MarkRefreshFailedInput,
  MarkUnavailableInput,
  ProductAiReviewRepository,
  UpsertReadyInput,
} from './ProductAiReviewRepository';
import type { ProductAiReviewRecord, ProductAiReviewStatus } from './domain/types';
import { isGeneratingStale } from './domain/freshness';

function nowIso(): string {
  return new Date().toISOString();
}

function emptyRecord(productId: string, status: ProductAiReviewStatus): ProductAiReviewRecord {
  const ts = nowIso();
  return {
    id: `mem-${productId}`,
    productId,
    status,
    summary: null,
    pros: [],
    cons: [],
    sources: [],
    evidenceLastCheckedAt: null,
    summaryGeneratedAt: null,
    evidenceHash: null,
    model: null,
    errorCode: null,
    errorMessage: null,
    refreshErrorCode: null,
    refreshFailedAt: null,
    refreshNextRetryAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** In-memory store for unit tests (not thread-safe across processes). */
export class InMemoryProductAiReviewRepository implements ProductAiReviewRepository {
  private readonly rows = new Map<string, ProductAiReviewRecord>();

  async findByProductId(productId: string): Promise<ProductAiReviewRecord | null> {
    const row = this.rows.get(productId);
    return row ? { ...row, pros: [...row.pros], cons: [...row.cons], sources: [...row.sources] } : null;
  }

  async claimGeneration(
    productId: string,
    evidenceHash: string,
    model: string,
  ): Promise<ClaimGenerationResult> {
    const existing = this.rows.get(productId);
    const ts = nowIso();

    if (!existing) {
      const created = emptyRecord(productId, 'GENERATING');
      created.evidenceHash = evidenceHash;
      created.model = model;
      created.updatedAt = ts;
      this.rows.set(productId, created);
      return { claimed: true, record: { ...created } };
    }

    if (existing.status === 'GENERATING' && !isGeneratingStale(existing.updatedAt)) {
      return { claimed: false, record: { ...existing } };
    }

    const next: ProductAiReviewRecord = {
      ...existing,
      status: 'GENERATING',
      evidenceHash,
      model,
      errorCode: null,
      errorMessage: null,
      updatedAt: ts,
    };
    this.rows.set(productId, next);
    return { claimed: true, record: { ...next } };
  }

  async markReady(input: UpsertReadyInput): Promise<ProductAiReviewRecord> {
    const existing = this.rows.get(input.productId);
    const ts = nowIso();
    const next: ProductAiReviewRecord = {
      ...(existing ?? emptyRecord(input.productId, 'READY')),
      status: 'READY',
      summary: input.summary,
      pros: input.pros,
      cons: input.cons,
      sources: input.sources,
      evidenceLastCheckedAt: input.evidenceLastCheckedAt,
      summaryGeneratedAt: input.summaryGeneratedAt,
      evidenceHash: input.evidenceHash,
      model: input.model,
      errorCode: null,
      errorMessage: null,
      refreshErrorCode: null,
      refreshFailedAt: null,
      refreshNextRetryAt: null,
      updatedAt: ts,
    };
    this.rows.set(input.productId, next);
    return { ...next };
  }

  async markRefreshFailed(input: MarkRefreshFailedInput): Promise<ProductAiReviewRecord> {
    const existing = this.rows.get(input.productId);
    if (!existing || existing.status !== 'READY') {
      throw new Error('Cannot record refresh failure without an existing READY review');
    }
    const ts = nowIso();
    const next: ProductAiReviewRecord = {
      ...existing,
      refreshErrorCode: input.refreshErrorCode,
      refreshFailedAt: input.refreshFailedAt,
      refreshNextRetryAt: input.refreshNextRetryAt,
      updatedAt: ts,
    };
    this.rows.set(input.productId, next);
    return { ...next };
  }

  async markUnavailable(input: MarkUnavailableInput): Promise<ProductAiReviewRecord> {
    const existing = this.rows.get(input.productId);
    const ts = nowIso();
    const next: ProductAiReviewRecord = {
      ...(existing ?? emptyRecord(input.productId, 'UNAVAILABLE')),
      status: 'UNAVAILABLE',
      evidenceHash: input.evidenceHash,
      evidenceLastCheckedAt: input.evidenceLastCheckedAt,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      updatedAt: ts,
    };
    this.rows.set(input.productId, next);
    return { ...next };
  }

  async markFailed(input: MarkFailedInput): Promise<ProductAiReviewRecord> {
    const existing = this.rows.get(input.productId);
    const ts = nowIso();
    const next: ProductAiReviewRecord = {
      ...(existing ?? emptyRecord(input.productId, 'FAILED')),
      status: 'FAILED',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      updatedAt: ts,
    };
    this.rows.set(input.productId, next);
    return { ...next };
  }
}
