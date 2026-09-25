import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getPipelineConfig, resetPipelineConfigCache } from '../../config/pipelineConfig';
import { limitProductsForUserImport, mapExtractedProducts } from './mapCandidates';

describe('mapExtractedProducts', () => {
  it('preserves order, evidence and omits nameless rows', () => {
    const rows = mapExtractedProducts({
      contentSourceId: 'src-1',
      extractionMethod: 'ai_extract',
      processorVersion: 'test',
      sourceMetadata: { platform: 'youtube' },
      products: [
        { name: '  ', brand: 'Sony' },
        { name: 'Sony WH-1000XM5', brand: 'Sony', model: 'WH-1000XM5', sortOrder: 1 },
        { name: 'Bose QuietComfort', brand: 'Bose', sortOrder: 2, sources: ['TRANSCRIPT'] },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.position, 1);
    assert.equal(rows[0]?.brand, 'Sony');
    assert.equal(rows[0]?.model, 'WH-1000XM5');
    assert.equal(rows[1]?.position, 2);
    assert.equal(rows[1]?.sources[0], 'TRANSCRIPT');
    assert.equal(rows[0]?.evidence.sourceMetadata && typeof rows[0].evidence.sourceMetadata, 'object');
  });

  it('normalizes extraction categories onto the Mystash taxonomy', () => {
    const rows = mapExtractedProducts({
      contentSourceId: 'src-1',
      extractionMethod: 'ai_extract',
      processorVersion: 'test',
      products: [
        { name: 'Galaxy S24', category: 'smartphones' },
        { name: 'Mystery Thing', category: 'unknown' },
        { name: 'Trail Tent', category: 'camping' },
      ],
    });
    assert.equal(rows[0]?.category, 'electronics');
    assert.equal(rows[1]?.category, null);
    assert.equal(rows[2]?.category, 'outdoors');
  });
});

describe('limitProductsForUserImport', () => {
  it('keeps the top N by confidence when over the max', () => {
    const limited = limitProductsForUserImport(
      [
        { name: 'A', confidence: 0.2, sortOrder: 1 },
        { name: 'B', confidence: 0.9, sortOrder: 2 },
        { name: 'C', confidence: 0.5, sortOrder: 3 },
        { name: 'D', confidence: 0.8, sortOrder: 4 },
        { name: 'E', confidence: 0.1, sortOrder: 5 },
      ],
      3,
    );
    assert.equal(limited.length, 3);
    assert.deepEqual(
      limited.map((p) => p.name),
      ['B', 'C', 'D'],
    );
  });

  it('retains all when under the max', () => {
    const limited = limitProductsForUserImport(
      [
        { name: 'A', confidence: 0.2 },
        { name: 'B', confidence: 0.9 },
      ],
      3,
    );
    assert.equal(limited.length, 2);
  });

  it('reads the configurable max from pipeline config', () => {
    resetPipelineConfigCache();
    const prev = process.env.MAX_PRODUCTS_PER_IMPORT;
    process.env.MAX_PRODUCTS_PER_IMPORT = '2';
    resetPipelineConfigCache();
    try {
      assert.equal(getPipelineConfig().maxProductsPerImport, 2);
    } finally {
      if (prev === undefined) delete process.env.MAX_PRODUCTS_PER_IMPORT;
      else process.env.MAX_PRODUCTS_PER_IMPORT = prev;
      resetPipelineConfigCache();
    }
  });
});

describe('creator ingest product cap is separate', () => {
  it('ProductValidator still uses MAX_PRODUCTS_PER_INGEST, not import max', () => {
    const code = readFileSync(join(__dirname, '../../products/ProductValidator.ts'), 'utf8');
    assert.match(code, /maxProductsPerIngest/);
    assert.doesNotMatch(code, /maxProductsPerImport/);
  });
});
