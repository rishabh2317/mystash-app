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
    assert.doesNotMatch(code, /catalog_products|cart_items|discovered_products/);
    assert.doesNotMatch(code, /ShoppingResolver|resolveIngestDrafts|ProductResolver/);
    assert.doesNotMatch(code, /runProgressiveExtract|previewProductLink|MerchantEnrichment/);
    assert.doesNotMatch(code, /\bfetch\(/);
  });
});
