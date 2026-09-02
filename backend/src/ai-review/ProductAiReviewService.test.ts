import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogService } from '../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../catalog/InMemoryCatalogRepository';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import { InMemoryProductAiReviewRepository } from './InMemoryProductAiReviewRepository';
import { ProductAiReviewService } from './ProductAiReviewService';
import type { GeminiReviewGenerator, GeminiReviewGenerateResult } from './GeminiAiReviewGenerator';
import { AI_REVIEW_EVIDENCE_TTL_MS } from './domain/freshness';
import { computeProductEvidenceHash } from './domain/evidenceHash';
import { productIdentityFromCatalog } from './domain/types';

function baseProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: overrides.id ?? 'prod-1',
    canonicalSlug: overrides.canonicalSlug ?? 'sony-xm5',
    brand: overrides.brand ?? 'Sony',
    name: overrides.name ?? 'WH-1000XM5',
    normalizedName: overrides.normalizedName ?? 'wh-1000xm5',
    model: overrides.model ?? 'XM5',
    category: overrides.category ?? 'headphones',
    description: overrides.description ?? null,
    imageUrl: overrides.imageUrl ?? null,
    merchant: overrides.merchant ?? null,
    merchantUrl: overrides.merchantUrl ?? null,
    preferredShoppingUrl: overrides.preferredShoppingUrl ?? null,
    affiliateUrl: overrides.affiliateUrl ?? null,
    shoppingProvider: overrides.shoppingProvider ?? null,
    currency: overrides.currency ?? null,
    price: overrides.price ?? null,
    status: overrides.status ?? 'ACTIVE',
    verificationStatus: overrides.verificationStatus ?? 'VERIFIED',
    verificationProvider: overrides.verificationProvider ?? 'test',
    verificationSource: overrides.verificationSource ?? 'test',
    verificationVersion: overrides.verificationVersion ?? 'v1',
    lastVerifiedAt: overrides.lastVerifiedAt ?? new Date().toISOString(),
    aiConfidence: overrides.aiConfidence ?? 0.9,
    matchConfidence: overrides.matchConfidence ?? 0.9,
    verificationConfidence: overrides.verificationConfidence ?? 0.9,
    mergedIntoId: overrides.mergedIntoId ?? null,
    metadata: overrides.metadata ?? {},
  };
}

function validPayload(summary = 'Strong ANC headphones with premium comfort.') {
  const now = new Date().toISOString();
  return {
    summary,
    pros: [
      {
        text: 'Excellent noise cancellation',
        evidence: [{ sourceId: 's1', claim: 'Reviewers praise ANC performance' }],
      },
    ],
    cons: [{ text: 'Premium price', evidence: [{ sourceId: 's1', claim: 'Costs more than rivals' }] }],
    sources: [
      {
        id: 's1',
        title: 'RTINGS Review',
        url: 'https://www.rtings.com/headphones/reviews/sony/wh-1000xm5',
        domain: 'rtings.com',
        publishedAt: null,
      },
    ],
    generatedAt: now,
    evidenceLastCheckedAt: now,
  };
}

function serviceWithGenerator(
  generator: GeminiReviewGenerator,
  enqueueCalls: Array<{ productId: string; refresh?: boolean }> = [],
) {
  const repo = new InMemoryCatalogRepository();
  repo.seed(baseProduct());
  const catalog = new CatalogService(repo);
  const reviewRepo = new InMemoryProductAiReviewRepository();
  const svc = new ProductAiReviewService(catalog, reviewRepo, generator, async (productId, _hash, options) => {
    enqueueCalls.push({ productId, refresh: options?.refresh });
    await svc.runGeneration(
      productId,
      computeProductEvidenceHash(productIdentityFromCatalog(baseProduct())),
      { refresh: options?.refresh },
    );
  });
  return { svc, reviewRepo, enqueueCalls };
}

async function seedStaleReady(
  reviewRepo: InMemoryProductAiReviewRepository,
  summary: string,
) {
  const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
  const stale = new Date(Date.now() - AI_REVIEW_EVIDENCE_TTL_MS - 1_000).toISOString();
  await reviewRepo.markReady({
    productId: 'prod-1',
    summary,
    pros: [{ text: 'Still relevant', evidence: [] }],
    cons: [],
    sources: [
      {
        id: 's1',
        title: 'RTINGS',
        url: 'https://www.rtings.com/headphones/reviews/sony/wh-1000xm5',
        domain: 'rtings.com',
        publishedAt: null,
      },
    ],
    evidenceLastCheckedAt: stale,
    summaryGeneratedAt: stale,
    evidenceHash: hash,
    model: 'gemini-2.5-flash-lite',
  });
}

describe('ProductAiReviewService', () => {
  it('returns not_found when catalog product is missing', async () => {
    const catalog = new CatalogService(new InMemoryCatalogRepository());
    const svc = new ProductAiReviewService(
      catalog,
      new InMemoryProductAiReviewRepository(),
      { async generate() { return { ok: false, code: 'api_error', message: 'nope' }; } },
      async () => undefined,
    );
    const out = await svc.getAiReview('missing');
    assert.equal(out.kind, 'not_found');
  });

  it('fresh cache returns immediately without Gemini call', async () => {
    let geminiCalls = 0;
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        geminiCalls += 1;
        return { ok: false, code: 'api_error', message: 'should not run' } as GeminiReviewGenerateResult;
      },
    });

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    const now = new Date().toISOString();
    await reviewRepo.markReady({
      productId: 'prod-1',
      summary: 'Cached summary',
      pros: [{ text: 'Good sound', evidence: [] }],
      cons: [],
      sources: [
        {
          id: 's1',
          title: 'RTINGS',
          url: 'https://www.rtings.com/headphones/reviews/sony/wh-1000xm5',
          domain: 'rtings.com',
          publishedAt: null,
        },
      ],
      evidenceLastCheckedAt: now,
      summaryGeneratedAt: now,
      evidenceHash: hash,
      model: 'gemini-2.5-flash-lite',
    });

    const out = await svc.getAiReview('prod-1');
    assert.equal(out.kind, 'response');
    if (out.kind === 'response') {
      assert.equal(out.body.status, 'available');
      if (out.body.status === 'available') {
        assert.equal(out.body.summary, 'Cached summary');
      }
    }
    assert.equal(geminiCalls, 0);
  });

  it('stale cache triggers regeneration while returning cached body', async () => {
    const enqueueCalls: Array<{ productId: string; refresh?: boolean }> = [];
    const { svc, reviewRepo } = serviceWithGenerator(
      {
        async generate() {
          return {
            ok: true,
            payload: validPayload(),
            model: 'gemini-2.5-flash-lite',
            sourceCount: 1,
          };
        },
      },
      enqueueCalls,
    );

    await seedStaleReady(reviewRepo, 'Stale but useful');

    const out = await svc.getAiReview('prod-1');
    assert.equal(out.kind, 'response');
    if (out.kind === 'response' && out.body.status === 'available') {
      assert.equal(out.body.summary, 'Stale but useful');
    }
    assert.equal(enqueueCalls.length, 1);
    assert.equal(enqueueCalls[0]?.refresh, true);
  });

  it('deduplicates concurrent generation claims', async () => {
    const repo = new InMemoryProductAiReviewRepository();
    const hash = 'abc';
    const first = await repo.claimGeneration('prod-1', hash, 'gemini-2.5-flash-lite');
    const second = await repo.claimGeneration('prod-1', hash, 'gemini-2.5-flash-lite');
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    assert.equal(second.record?.status, 'GENERATING');
  });

  it('persists valid Gemini output', async () => {
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        return {
          ok: true,
          payload: validPayload(),
          model: 'gemini-2.5-flash-lite',
          sourceCount: 1,
        };
      },
    });

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await svc.runGeneration('prod-1', hash);
    const row = await reviewRepo.findByProductId('prod-1');
    assert.equal(row?.status, 'READY');
    assert.equal(row?.sources.length, 1);
    assert.equal(row?.pros[0]?.text, 'Excellent noise cancellation');
  });

  it('rejects malformed Gemini output without fabricating fallback', async () => {
    let calls = 0;
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        calls += 1;
        return { ok: false, code: 'validation_failed', message: 'bad output' };
      },
    });

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await svc.runGeneration('prod-1', hash);
    const row = await reviewRepo.findByProductId('prod-1');
    assert.equal(row?.status, 'UNAVAILABLE');
    assert.equal(row?.errorCode, 'validation_failed');
    assert.equal(calls, 1);
  });

  it('returns unavailable API state for insufficient evidence', async () => {
    const repo = new InMemoryCatalogRepository();
    repo.seed(baseProduct());
    const catalogSvc = new CatalogService(repo);
    const reviewRepo = new InMemoryProductAiReviewRepository();
    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    const checkedAt = new Date().toISOString();
    await reviewRepo.markUnavailable({
      productId: 'prod-1',
      errorCode: 'insufficient_evidence',
      errorMessage: 'Not enough grounded sources',
      evidenceHash: hash,
      evidenceLastCheckedAt: checkedAt,
    });

    const svc = new ProductAiReviewService(
      catalogSvc,
      reviewRepo,
      { async generate() { return { ok: false, code: 'api_error', message: 'nope' }; } },
      async () => undefined,
    );

    const out = await svc.getAiReview('prod-1');
    assert.equal(out.kind, 'response');
    if (out.kind === 'response') {
      assert.equal(out.body.status, 'unavailable');
      if (out.body.status === 'unavailable') {
        assert.equal(out.body.retryEligible, false);
      }
    }
  });

  it('returns generating state when no cache exists', async () => {
    const { svc } = serviceWithGenerator({
      async generate() {
        return { ok: true, payload: validPayload(), model: 'gemini-2.5-flash-lite', sourceCount: 1 };
      },
    });
    const out = await svc.getAiReview('prod-1');
    assert.equal(out.kind, 'response');
    if (out.kind === 'response') {
      assert.equal(out.body.status, 'generating');
    }
  });

  it('retries transient Gemini failures during initial generation', async () => {
    let calls = 0;
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        calls += 1;
        if (calls < 2) return { ok: false, code: 'api_error', message: 'down' };
        return {
          ok: true,
          payload: validPayload(),
          model: 'gemini-2.5-flash-lite',
          sourceCount: 1,
        };
      },
    });

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await svc.runGeneration('prod-1', hash);
    assert.equal(calls, 2);
    assert.equal((await reviewRepo.findByProductId('prod-1'))?.status, 'READY');
  });

  it('marks initial generation failed after 3 transient retries are exhausted', async () => {
    let calls = 0;
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        calls += 1;
        return { ok: false, code: 'api_error', message: 'down' };
      },
    });

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await assert.rejects(
      () => svc.runGeneration('prod-1', hash),
      (err: unknown) => err instanceof Error && err.name === 'AiReviewGenerationExhaustedError',
    );
    assert.equal(calls, 3);
    const row = await reviewRepo.findByProductId('prod-1');
    assert.equal(row?.status, 'FAILED');
    assert.equal(row?.errorCode, 'api_error');
  });

  it('keeps stale READY review available when refresh fails', async () => {
    let calls = 0;
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        calls += 1;
        return { ok: false, code: 'api_error', message: 'down' };
      },
    });

    await seedStaleReady(reviewRepo, 'Keep this summary');

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await svc.runGeneration('prod-1', hash, { refresh: true });
    assert.equal(calls, 3);

    const row = await reviewRepo.findByProductId('prod-1');
    assert.equal(row?.status, 'READY');
    assert.equal(row?.summary, 'Keep this summary');
    assert.equal(row?.refreshErrorCode, 'api_error');
    assert.ok(row?.refreshFailedAt);
    assert.ok(row?.refreshNextRetryAt);

    const out = await svc.getAiReview('prod-1');
    if (out.kind === 'response' && out.body.status === 'available') {
      assert.equal(out.body.summary, 'Keep this summary');
    } else {
      assert.fail('expected available stale review');
    }
  });

  it('replaces stale READY review after successful refresh', async () => {
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        return {
          ok: true,
          payload: validPayload('Fresh refreshed summary'),
          model: 'gemini-2.5-flash-lite',
          sourceCount: 1,
        };
      },
    });

    await seedStaleReady(reviewRepo, 'Old summary');
    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await svc.runGeneration('prod-1', hash, { refresh: true });

    const row = await reviewRepo.findByProductId('prod-1');
    assert.equal(row?.status, 'READY');
    assert.equal(row?.summary, 'Fresh refreshed summary');
    assert.equal(row?.refreshErrorCode, null);
    assert.ok(row?.evidenceLastCheckedAt);
    assert.ok(Date.parse(row!.evidenceLastCheckedAt!) > Date.now() - 60_000);
  });

  it('does not retry insufficient evidence during initial generation', async () => {
    let calls = 0;
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        calls += 1;
        return { ok: false, code: 'insufficient_evidence', message: 'no sources' };
      },
    });

    const hash = computeProductEvidenceHash(productIdentityFromCatalog(baseProduct()));
    await svc.runGeneration('prod-1', hash);
    assert.equal(calls, 1);
    assert.equal((await reviewRepo.findByProductId('prod-1'))?.status, 'UNAVAILABLE');
  });

  it('returns accurate retryEligible for failed initial generation', async () => {
    const { svc, reviewRepo } = serviceWithGenerator({
      async generate() {
        return { ok: false, code: 'config_missing', message: 'missing key' };
      },
    });
    await reviewRepo.markFailed({
      productId: 'prod-1',
      errorCode: 'config_missing',
      errorMessage: 'missing key',
    });
    const out = await svc.getAiReview('prod-1');
    if (out.kind === 'response' && out.body.status === 'unavailable') {
      assert.equal(out.body.retryEligible, false);
    } else {
      assert.fail('expected unavailable');
    }
  });
});
