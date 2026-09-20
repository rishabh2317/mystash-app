import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CONTENT_SOURCE_QUEUE,
  contentSourceProcessingJobId,
  type ContentSourceProcessingJobData,
} from './contentSourceQueue';

const SOURCE_ID = '33333333-3333-4333-8333-333333333333';

describe('content source processing queue', () => {
  it('reuses the existing BullMQ naming convention', () => {
    assert.equal(CONTENT_SOURCE_QUEUE, 'content-source-processing');
  });

  it('derives job identity from the content source, never the user', () => {
    const jobId = contentSourceProcessingJobId(SOURCE_ID);
    assert.equal(jobId, `content-source-${SOURCE_ID}`);

    const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    assert.equal(
      contentSourceProcessingJobId(SOURCE_ID),
      contentSourceProcessingJobId(SOURCE_ID),
    );
    assert.doesNotMatch(jobId, new RegExp(userA));
    assert.doesNotMatch(jobId, new RegExp(userB));
  });

  it('carries stable ids only — never the shared payload', () => {
    const data: ContentSourceProcessingJobData = {
      contentSourceId: SOURCE_ID,
      userImportId: '44444444-4444-4444-8444-444444444444',
      traceId: 'trace-1',
    };
    assert.deepEqual(Object.keys(data).sort(), ['contentSourceId', 'traceId', 'userImportId']);

    const src = readFileSync(join(__dirname, 'contentSourceQueue.ts'), 'utf8');
    assert.doesNotMatch(src, /rawInput|raw_input|normalizedUrl|sourceUrl/);
  });

  it('fails fast with the existing error when Redis is unavailable', async () => {
    const { setRedisAvailabilityForTests, REDIS_UNAVAILABLE_ENQUEUE_ERROR } = await import(
      '../../workers/redisConnection'
    );
    const { enqueueContentSourceProcessing } = await import('./contentSourceQueue');
    setRedisAvailabilityForTests(false);

    const start = Date.now();
    await assert.rejects(
      () =>
        enqueueContentSourceProcessing({
          contentSourceId: SOURCE_ID,
          userImportId: '44444444-4444-4444-8444-444444444444',
        }),
      (err: Error) => err.message === REDIS_UNAVAILABLE_ENQUEUE_ERROR,
    );
    assert.ok(Date.now() - start < 400);
  });

  it('keeps enqueue free of product processing', () => {
    const src = readFileSync(join(__dirname, 'contentSourceQueue.ts'), 'utf8');
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    assert.match(code, /contentSourceProcessingJobId/);
    assert.doesNotMatch(code, /createContentSourceProcessor|runProgressiveExtract/);
    assert.doesNotMatch(code, /product-intelligence|ProductResolver|resolveIngestDrafts/);
    assert.doesNotMatch(code, /catalog_products|cart_items|discovered_products/);
    assert.doesNotMatch(code, /openai|OpenAI|gemini|Gemini|tavily|Tavily/);
    assert.doesNotMatch(code, /yt-dlp|ffmpeg|previewProductLink|MerchantEnrichment/);
    assert.doesNotMatch(code, /\bfetch\(/);
  });
});
