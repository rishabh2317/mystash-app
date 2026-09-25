import type { CatalogService } from '../catalog/CatalogService';
import type { DiscoveredProductRecord } from '../discovered/domain/types';
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
  ProductIdentityContext,
} from './domain/types';
import { productIdentityFromCatalog, productIdentityFromDiscovered } from './domain/types';
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

/** Optional discovered lookup — catalogue path does not require it. */
export type ProductAiReviewDiscoveredPort = {
  getById(id: string): Promise<DiscoveredProductRecord | null>;
};

export class ProductAiReviewService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly repo: ProductAiReviewRepository,
    private readonly generator: GeminiReviewGenerator,
    private readonly enqueue: ProductAiReviewEnqueue,
    private readonly discovered: ProductAiReviewDiscoveredPort | null = null,
  ) {}

  async getAiReview(productId: string): Promise<
    | { kind: 'not_found' }
    | { kind: 'response'; body: ProductAiReviewApiResponse; httpStatus: number }
  > {
    const product = await this.catalog.resolveActiveProduct(productId);
    if (product && product.status !== 'HIDDEN') {
      return this.respondForIdentity(productIdentityFromCatalog(product));
    }

    const discoveredIdentity = await this.resolveDiscoveredIdentity(productId);
    if (!discoveredIdentity) {
      return { kind: 'not_found' };
    }
    return this.respondForIdentity(discoveredIdentity);
  }

  async runGeneration(
    productId: string,
    evidenceHash: string,
    options: RunGenerationOptions = {},
  ): Promise<void> {
    const started = performance.now();
    const product = await this.catalog.resolveActiveProduct(productId);
    let identity: ProductIdentityContext | null = null;
    if (product) {
      identity = productIdentityFromCatalog(product);
    } else {
      identity = await this.resolveDiscoveredIdentity(productId);
    }

    if (!identity) {
      if (!options.refresh) {
        await this.repo.markFailed({
          productId,
          errorCode: 'product_not_found',
          errorMessage: 'Product not found during generation',
        });
      }
      return;
    }

    const hash = computeProductEvidenceHash(identity);
    if (hash !== evidenceHash) {
      logAiReviewEvent('ai_review.generation.skipped_hash_mismatch', { productId, evidenceHash, hash });
      return;
    }

    const existing = await this.repo.findByProductId(identity.productId);
    const refresh = options.refresh === true || (existing?.status === 'READY' && existing.summary != null);

    const result = await executeGenerationWithRetries(this.generator, identity);
    const elapsedMs = Math.round(performance.now() - started);
    const subjectId = identity.productId;

    if (!result.ok) {
      if (refresh) {
        const failedAt = new Date().toISOString();
        await this.repo.markRefreshFailed({
          productId: subjectId,
          refreshErrorCode: result.code,
          refreshFailedAt: failedAt,
          refreshNextRetryAt: new Date(Date.now() + AI_REVIEW_REFRESH_RETRY_BACKOFF_MS).toISOString(),
        });
        logAiReviewEvent('ai_review.refresh.failed', {
          productId: subjectId,
          code: result.code,
          elapsedMs,
          attemptsExhausted: true,
        });
        return;
      }

      if (result.code === 'insufficient_evidence' || result.code === 'validation_failed') {
        await this.repo.markUnavailable({
          productId: subjectId,
          errorCode: result.code,
          errorMessage: result.message,
          evidenceHash: hash,
          evidenceLastCheckedAt: new Date().toISOString(),
        });
        logAiReviewEvent('ai_review.generation.unavailable', {
          productId: subjectId,
          code: result.code,
          elapsedMs,
        });
        return;
      }

      await this.repo.markFailed({
        productId: subjectId,
        errorCode: result.code,
        errorMessage: result.message,
      });
      logAiReviewEvent('ai_review.generation.failed', {
        productId: subjectId,
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
      productId: subjectId,
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
      productId: subjectId,
      model: result.model,
      sourceCount: result.sourceCount,
      elapsedMs,
    });
  }

  /**
   * Catalogue-first. Linked discovered products reuse the catalogue subject so
   * cache stays shared. Unlinked discovered products use the discovered id.
   */
  private async resolveDiscoveredIdentity(productId: string): Promise<ProductIdentityContext | null> {
    if (!this.discovered) return null;
    const record = await this.discovered.getById(productId);
    if (!record || record.internalStatus !== 'ACTIVE') return null;

    if (record.catalogProductId) {
      const linked = await this.catalog.resolveActiveProduct(record.catalogProductId);
      if (linked && linked.status !== 'HIDDEN') {
        return productIdentityFromCatalog(linked);
      }
    }

    if (!record.name.trim()) return null;
    return productIdentityFromDiscovered(record);
  }

  /** Shared cache / claim / enqueue path for catalogue and discovered subjects. */
  private async respondForIdentity(
    identity: ProductIdentityContext,
  ): Promise<{ kind: 'response'; body: ProductAiReviewApiResponse; httpStatus: number }> {
    const evidenceHash = computeProductEvidenceHash(identity);
    const cached = await this.repo.findByProductId(identity.productId);

    if (cached?.status === 'READY' && isEvidenceFresh(cached.evidenceLastCheckedAt)) {
      logAiReviewEvent('ai_review.cache.hit', {
        productId: identity.productId,
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
        productId: identity.productId,
        evidenceLastCheckedAt: cached.evidenceLastCheckedAt,
      });
      if (!isRefreshBackoffActive(cached.refreshNextRetryAt)) {
        void this.scheduleGeneration(identity.productId, evidenceHash, { refresh: true }).catch(
          () => undefined,
        );
      }
      return {
        kind: 'response',
        httpStatus: 200,
        body: toAvailableResponse(cached),
      };
    }

    if (cached?.status === 'GENERATING') {
      logAiReviewEvent('ai_review.generating.in_progress', { productId: identity.productId });
      return {
        kind: 'response',
        httpStatus: 200,
        body: generatingResponse(identity.productId),
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
          identity.productId,
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
          identity.productId,
          cached.errorCode ?? 'api_error',
          cached.errorMessage,
          isRetryEligibleApiReason(cached.errorCode),
        ),
      };
    }

    const claim = await this.repo.claimGeneration(identity.productId, evidenceHash, resolveModelName());
    if (!claim.claimed) {
      if (claim.record?.status === 'READY') {
        return { kind: 'response', httpStatus: 200, body: toAvailableResponse(claim.record) };
      }
      return { kind: 'response', httpStatus: 200, body: generatingResponse(identity.productId) };
    }

    logAiReviewEvent('ai_review.generation.started', {
      productId: identity.productId,
      evidenceHash,
      deduplicated: false,
    });
    void this.scheduleGeneration(identity.productId, evidenceHash).catch(() => undefined);
    return { kind: 'response', httpStatus: 200, body: generatingResponse(identity.productId) };
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
