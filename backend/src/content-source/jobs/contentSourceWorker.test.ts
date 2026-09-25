import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('content source processing worker', () => {
  it('delegates extraction to ContentSourceProcessor and does not write Catalog or Bag', () => {
    const src = readFileSync(join(__dirname, 'contentSourceWorker.ts'), 'utf8');
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    assert.match(code, /createResolvingContentSourceProcessor/);
    assert.match(code, /duplicateBullmqWorkerRedis/);
    assert.match(code, /CONTENT_SOURCE_QUEUE/);
    assert.match(code, /content_source\.worker\.created/);
    assert.match(code, /content_source\.worker\.ready/);
    assert.match(code, /content_source\.job\.active/);
    assert.match(code, /content_source\.worker\.error/);
    assert.doesNotMatch(code, /getBullmqCommandRedis\(\)\.duplicate\(\)/);
    assert.doesNotMatch(code, /catalog_products|cart_items|discovered_products/);
    assert.doesNotMatch(code, /ShoppingResolver|resolveIngestDrafts|ProductResolver/);
    assert.doesNotMatch(code, /runProgressiveExtract|previewProductLink|MerchantEnrichment/);
    assert.doesNotMatch(code, /\bfetch\(/);
  });

  it('worker Redis clients reconnect instead of using the optional-enqueue fail-fast policy', async () => {
    const { duplicateBullmqWorkerRedis, buildBullmqConnectionOptions } = await import(
      '../../workers/redisConnection'
    );
    const enqueueOpts = buildBullmqConnectionOptions('redis://localhost:6379');
    assert.equal(enqueueOpts.retryStrategy?.(1), null);

    const workerRedis = duplicateBullmqWorkerRedis('test-content-source-worker');
    try {
      assert.equal(workerRedis.options.maxRetriesPerRequest, null);
      assert.notEqual(workerRedis.options.retryStrategy?.(1), null);
      assert.equal(typeof workerRedis.options.retryStrategy?.(1), 'number');
      assert.ok((workerRedis.options.retryStrategy?.(1) as number) > 0);
    } finally {
      workerRedis.disconnect();
    }
  });
});
