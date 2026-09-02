import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GeminiReviewGenerator } from '../GeminiAiReviewGenerator';
import {
  TRANSIENT_MAX_ATTEMPTS,
  OUTPUT_MAX_ATTEMPTS,
  executeGenerationWithRetries,
  isRetryEligibleApiReason,
  maxAttemptsForFailureCode,
} from './retryPolicy';
import { productIdentityFromCatalog } from './types';
import type { CatalogProduct } from '../../product-intelligence/domain/types';

const identity = productIdentityFromCatalog({
  id: 'prod-1',
  canonicalSlug: 'sony-xm5',
  brand: 'Sony',
  name: 'WH-1000XM5',
  normalizedName: 'wh-1000xm5',
  model: 'XM5',
  category: 'headphones',
  description: null,
  imageUrl: null,
  merchant: null,
  merchantUrl: null,
  preferredShoppingUrl: null,
  affiliateUrl: null,
  shoppingProvider: null,
  currency: null,
  price: null,
  status: 'ACTIVE',
  verificationStatus: 'VERIFIED',
  verificationProvider: 'test',
  verificationSource: 'test',
  verificationVersion: 'v1',
  lastVerifiedAt: new Date().toISOString(),
  aiConfidence: 0.9,
  matchConfidence: 0.9,
  verificationConfidence: 0.9,
  mergedIntoId: null,
  metadata: {},
} as CatalogProduct);

describe('retryPolicy', () => {
  it('retries transient failures up to 3 attempts', async () => {
    let calls = 0;
    const generator: GeminiReviewGenerator = {
      async generate() {
        calls += 1;
        if (calls < 3) return { ok: false, code: 'api_error', message: 'down' };
        return {
          ok: true,
          payload: {
            summary: 'ok',
            pros: [{ text: 'pro', evidence: [] }],
            cons: [],
            sources: [
              {
                id: 's1',
                title: 'Src',
                url: 'https://example.com',
                domain: 'example.com',
                publishedAt: null,
              },
            ],
            generatedAt: new Date().toISOString(),
            evidenceLastCheckedAt: new Date().toISOString(),
          },
          model: 'gemini-2.5-flash-lite',
          sourceCount: 1,
        };
      },
    };

    const result = await executeGenerationWithRetries(generator, identity, async () => undefined);
    assert.equal(result.ok, true);
    assert.equal(calls, 3);
  });

  it('stops after 3 transient attempts are exhausted', async () => {
    let calls = 0;
    const generator: GeminiReviewGenerator = {
      async generate() {
        calls += 1;
        return { ok: false, code: 'timeout', message: 'timed out' };
      },
    };

    const result = await executeGenerationWithRetries(generator, identity, async () => undefined);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'timeout');
    assert.equal(calls, TRANSIENT_MAX_ATTEMPTS);
  });

  it('retries invalid JSON output up to 2 attempts', async () => {
    let calls = 0;
    const generator: GeminiReviewGenerator = {
      async generate() {
        calls += 1;
        if (calls === 1) return { ok: false, code: 'parse_failed', message: 'bad json' };
        return {
          ok: true,
          payload: {
            summary: 'ok',
            pros: [{ text: 'pro', evidence: [] }],
            cons: [],
            sources: [
              {
                id: 's1',
                title: 'Src',
                url: 'https://example.com',
                domain: 'example.com',
                publishedAt: null,
              },
            ],
            generatedAt: new Date().toISOString(),
            evidenceLastCheckedAt: new Date().toISOString(),
          },
          model: 'gemini-2.5-flash-lite',
          sourceCount: 1,
        };
      },
    };

    const result = await executeGenerationWithRetries(generator, identity, async () => undefined);
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it('does not retry insufficient evidence', async () => {
    let calls = 0;
    const generator: GeminiReviewGenerator = {
      async generate() {
        calls += 1;
        return { ok: false, code: 'insufficient_evidence', message: 'no sources' };
      },
    };

    const result = await executeGenerationWithRetries(generator, identity, async () => undefined);
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  });

  it('exposes accurate retryEligible reasons', () => {
    assert.equal(maxAttemptsForFailureCode('api_error'), TRANSIENT_MAX_ATTEMPTS);
    assert.equal(maxAttemptsForFailureCode('parse_failed'), OUTPUT_MAX_ATTEMPTS);
    assert.equal(maxAttemptsForFailureCode('validation_failed'), 1);
    assert.equal(isRetryEligibleApiReason('api_error'), true);
    assert.equal(isRetryEligibleApiReason('insufficient_evidence'), false);
    assert.equal(isRetryEligibleApiReason('config_missing'), false);
  });
});
