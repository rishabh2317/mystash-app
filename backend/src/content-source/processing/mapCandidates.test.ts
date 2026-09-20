import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapExtractedProducts } from './mapCandidates';

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
});
