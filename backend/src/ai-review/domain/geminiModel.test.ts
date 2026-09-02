import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_AI_REVIEW_MODEL,
  isDeprecatedAiReviewModel,
  recommendedModelForDeprecated,
  resolveAiReviewModel,
} from './geminiModel';

describe('geminiModel', () => {
  it('defaults to gemini-3.5-flash-lite when unset', () => {
    const prevReview = process.env.GEMINI_AI_REVIEW_MODEL;
    delete process.env.GEMINI_AI_REVIEW_MODEL;
    try {
      assert.equal(resolveAiReviewModel(), DEFAULT_AI_REVIEW_MODEL);
    } finally {
      if (prevReview) process.env.GEMINI_AI_REVIEW_MODEL = prevReview;
    }
  });

  it('maps deprecated flash-lite models to gemini-3.5-flash-lite', () => {
    const prev = process.env.GEMINI_AI_REVIEW_MODEL;
    process.env.GEMINI_AI_REVIEW_MODEL = 'gemini-2.5-flash-lite';
    try {
      assert.equal(resolveAiReviewModel(), 'gemini-3.5-flash-lite');
      assert.equal(isDeprecatedAiReviewModel('gemini-2.5-flash-lite'), true);
      assert.equal(recommendedModelForDeprecated('gemini-2.5-flash-lite'), 'gemini-3.5-flash-lite');
    } finally {
      if (prev) process.env.GEMINI_AI_REVIEW_MODEL = prev;
      else delete process.env.GEMINI_AI_REVIEW_MODEL;
    }
  });
});
