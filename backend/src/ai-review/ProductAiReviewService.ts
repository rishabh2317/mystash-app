import type { CatalogService } from '../catalog/CatalogService';
import type { GeminiReviewGenerator } from './GeminiAiReviewGenerator';
import { computeProductEvidenceHash } from './domain/evidenceHash';
import { AiReviewGenerationExhaustedError } from './domain/generationErrors';
import {
  AI_REVIEW_REFRESH_RETRY_BACKOFF_MS,
  isEvidenceFresh,
  isRefreshBackoffActive,
} from './domain/freshness';
import { executeGenerationWithRetries, isRetryEligibleApiReason, isTransientFailureCode } from './domain/retryPolicy';
import { logAiReviewEvent } from './observability';
import type { ProductAiReviewRepository } from './ProductAiReviewRepository';
import type {
  ProductAiReviewApiResponse,
  ProductAiReviewRecord,
} from './domain/types';
import { productIdentityFromCatalog } from './domain/types';
import { resolveAiReviewModel } from './domain/geminiModel';

export type ProductAiReviewEnqueueOptions = {
  refresh?: boolean;
};

export type ProductAiReviewEnqueue = (
  productId: string,
  evidenceHash: string,
  options?: ProductAiReviewEnqueueOptions,
) => Promise<void>;

export type RunGenerationOptions = {
  refresh?: boolean;
};

export class ProductAiReviewService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly repo: ProductAiReviewRepository,
    private readonly generator: GeminiReviewGenerator,
    private readonly enqueue: ProductAiReviewEnqueue,
  ) {}

  async getAiReview(productId: string): Promise<
    | { kind: 'not_found' }
    | { kind: 'response'; body: ProductAiReviewApiResponse; httpStatus: number }
  > {
    const product = await this.catalog.resolveActiveProduct(productId);
    if (!product || product.status === 'HIDDEN') {
      return { kind: 'not_found' };
    }

    const identity = productIdentityFromCatalog(product);
    const evidenceHash = computeProductEvidenceHash(identity);
    const cached = await this.repo.findByProductId(product.id);

    if (cached?.status === 'READY' && isEvidenceFresh(cached.evidenceLastCheckedAt)) {
      logAiReviewEvent('ai_review.cache.hit', {
        productId: product.id,
        evidenceLastCheckedAt: cached.evidenceLastCheckedAt,
      });
      return {
        kind: 'response',
        httpStatus: 200,
        body: toAvailableResponse(cached),
      };
    }

    if (cached?.status === 'READY' && !isEvidenceFresh(cached.evidenceLastCheckedAt)) {
      logAiReviewEvent('ai_review.cache.stale', {
        productId: product.id,
        evidenceLastCheckedAt: cached.evidenceLastCheckedAt,
      });
      if (!isRefreshBackoffActive(cached.refreshNextRetryAt)) {
        void this.scheduleGeneration(product.id, evidenceHash, { refresh: true }).catch(() => undefined);
      }
      return {
        kind: 'response',
        httpStatus: 200,
        body: toAvailableResponse(cached),
      };
    }

    if (cached?.status === 'GENERATING') {
      logAiReviewEvent('ai_review.generating.in_progress', { productId: product.id });
      return {
        kind: 'response',
        httpStatus: 200,
        body: generatingResponse(product.id),
      };
    }

    if (
      cached?.status === 'UNAVAILABLE' &&
      cached.evidenceHash === evidenceHash &&
      isEvidenceFresh(cached.evidenceLastCheckedAt)
    ) {
      return {
        kind: 'response',
        httpStatus: 200,
        body: unavailableResponse(
          product.id,
          cached.errorCode ?? 'insufficient_evidence',
          cached.errorMessage,
        ),
      };
    }

    if (cached?.status === 'FAILED') {
      return {
        kind: 'response',
        httpStatus: 200,
        body: unavailableResponse(
          product.id,
          cached.errorCode ?? 'api_error',
          cached.errorMessage,
          isRetryEligibleApiReason(cached.errorCode),
        ),
      };
    }

    const claim = await this.repo.claimGeneration(product.id, evidenceHash, resolveModelName());
    if (!claim.claimed) {
      if (claim.record?.status === 'READY') {
        return { kind: 'response', httpStatus: 200, body: toAvailableResponse(claim.record) };
      }
      return { kind: 'response', httpStatus: 200, body: generatingResponse(product.id) };
    }

    logAiReviewEvent('ai_review.generation.started', {
      productId: product.id,
      evidenceHash,
      deduplicated: false,
    });
    void this.scheduleGeneration(product.id, evidenceHash).catch(() => undefined);
    return { kind: 'response', httpStatus: 200, body: generatingResponse(product.id) };
  }

  async runGeneration(
    productId: string,
    evidenceHash: string,
    options: RunGenerationOptions = {},
  ): Promise<void> {
    const started = performance.now();
    const product = await this.catalog.resolveActiveProduct(productId);
    if (!product) {
      if (!options.refresh) {
        await this.repo.markFailed({
          productId,
          errorCode: 'product_not_found',
          errorMessage: 'Product not found during generation',
        });
      }
      return;
    }

    const identity = productIdentityFromCatalog(product);
    const hash = computeProductEvidenceHash(identity);
    if (hash !== evidenceHash) {
      logAiReviewEvent('ai_review.generation.skipped_hash_mismatch', { productId, evidenceHash, hash });
      return;
    }

    const existing = await this.repo.findByProductId(productId);
    const refresh = options.refresh === true || (existing?.status === 'READY' && existing.summary != null);

    const result = await executeGenerationWithRetries(this.generator, identity);
    const elapsedMs = Math.round(performance.now() - started);

    if (!result.ok) {
      if (refresh) {
        const failedAt = new Date().toISOString();
        await this.repo.markRefreshFailed({
          productId,
          refreshErrorCode: result.code,
          refreshFailedAt: failedAt,
          refreshNextRetryAt: new Date(Date.now() + AI_REVIEW_REFRESH_RETRY_BACKOFF_MS).toISOString(),
        });
        logAiReviewEvent('ai_review.refresh.failed', {
          productId,
          code: result.code,
          elapsedMs,
          attemptsExhausted: true,
        });
        return;
      }

      if (result.code === 'insufficient_evidence' || result.code === 'validation_failed') {
        await this.repo.markUnavailable({
          productId,
          errorCode: result.code,
          errorMessage: result.message,
          evidenceHash: hash,
          evidenceLastCheckedAt: new Date().toISOString(),
        });
        logAiReviewEvent('ai_review.generation.unavailable', {
          productId,
          code: result.code,
          elapsedMs,
        });
        return;
      }

      await this.repo.markFailed({
        productId,
        errorCode: result.code,
        errorMessage: result.message,
      });
      logAiReviewEvent('ai_review.generation.failed', {
        productId,
        code: result.code,
        retryEligible: isRetryEligibleApiReason(result.code),
        elapsedMs,
      });

      if (isTransientFailureCode(result.code)) {
        throw new AiReviewGenerationExhaustedError(result.code, result.message);
      }
      return;
    }

    const now = result.payload.evidenceLastCheckedAt || new Date().toISOString();
    await this.repo.markReady({
      productId,
      summary: result.payload.summary,
      pros: result.payload.pros,
      cons: result.payload.cons,
      sources: result.payload.sources,
      evidenceLastCheckedAt: now,
      summaryGeneratedAt: result.payload.generatedAt || now,
      evidenceHash: hash,
      model: result.model,
    });

    logAiReviewEvent(refresh ? 'ai_review.refresh.completed' : 'ai_review.generation.completed', {
      productId,
      model: result.model,
      sourceCount: result.sourceCount,
      elapsedMs,
    });
  }

  private async scheduleGeneration(
    productId: string,
    evidenceHash: string,
    options?: ProductAiReviewEnqueueOptions,
  ): Promise<void> {
    await this.enqueue(productId, evidenceHash, options);
  }
}

function resolveModelName(): string {
  return resolveAiReviewModel();
}

function toAvailableResponse(record: ProductAiReviewRecord): ProductAiReviewApiResponse {
  return {
    status: 'available',
    catalogProductId: record.productId,
    summary: record.summary ?? '',
    pros: record.pros.map((p) => p.text).filter(Boolean).slice(0, 3),
    cons: record.cons.map((p) => p.text).filter(Boolean).slice(0, 3),
    sources: record.sources.map((s) => ({ name: s.title, url: s.url })),
    updatedAt: record.summaryGeneratedAt ?? record.updatedAt,
    evidenceLastCheckedAt: record.evidenceLastCheckedAt ?? record.updatedAt,
  };
}

function generatingResponse(productId: string): ProductAiReviewApiResponse {
  return {
    status: 'generating',
    catalogProductId: productId,
    message: 'AI Review is being prepared from current web sources.',
  };
}

function unavailableResponse(
  productId: string,
  reason: string,
  message: string | null,
  retryEligible?: boolean,
): ProductAiReviewApiResponse {
  return {
    status: 'unavailable',
    catalogProductId: productId,
    reason,
    message:
      message?.trim() ||
      'AI Review summaries are not available for this product yet.',
    retryEligible: retryEligible ?? isRetryEligibleApiReason(reason),
  };
}
