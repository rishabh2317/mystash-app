import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mayEnterMetadataEnrichment } from './MetadataEnrichmentAdmissionPolicy';

describe('MetadataEnrichmentAdmissionPolicy', () => {
  it('preserves pre-capability shortlist admission behavior', () => {
    assert.equal(
      mayEnterMetadataEnrichment({
        url: 'https://shop.example/p/phone',
        sourceTier: 'retailer',
      }),
      true,
    );
    assert.equal(
      mayEnterMetadataEnrichment({
        url: 'https://believeintherun.com/shoe-review',
        sourceTier: 'editorial',
      }),
      true,
    );
    assert.equal(
      mayEnterMetadataEnrichment({
        url: 'https://www.youtube.com/watch?v=review',
        sourceTier: 'editorial',
      }),
      false,
    );
    assert.equal(
      mayEnterMetadataEnrichment({
        url: 'https://shop.example/search?q=phone',
        sourceTier: 'retailer',
      }),
      false,
    );
  });
});
