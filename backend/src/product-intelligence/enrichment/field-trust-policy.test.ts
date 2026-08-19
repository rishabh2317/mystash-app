import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIELD_TRUST_POLICY } from './field-trust-policy';

describe('FIELD_TRUST_POLICY', () => {
  it('keeps identity, commerce, image, and specification priorities centralized', () => {
    assert.deepEqual(FIELD_TRUST_POLICY.name[0], {
      sourceType: 'OFFICIAL',
      pageType: 'PRODUCT',
    });
    assert.deepEqual(FIELD_TRUST_POLICY.offer[0], {
      sourceType: 'MARKETPLACE',
      pageType: 'PRODUCT',
    });
    assert.deepEqual(FIELD_TRUST_POLICY.gallery[0], {
      sourceType: 'OFFICIAL',
      pageType: 'PRODUCT',
    });
    assert.deepEqual(FIELD_TRUST_POLICY.specifications[0], {
      sourceType: 'OFFICIAL',
      pageType: 'SPECIFICATIONS',
    });
  });
});
