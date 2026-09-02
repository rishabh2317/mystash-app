import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeProductEvidenceHash } from './evidenceHash';
import type { ProductIdentityContext } from './types';

describe('computeProductEvidenceHash', () => {
  const base: ProductIdentityContext = {
    productId: 'prod-1',
    name: 'WH-1000XM5',
    brand: 'Sony',
    model: 'XM5',
    category: 'headphones',
    canonicalSlug: 'sony-xm5',
    specifications: { color: 'black' },
  };

  it('is stable for identical product identity', () => {
    const a = computeProductEvidenceHash(base);
    const b = computeProductEvidenceHash({ ...base });
    assert.equal(a, b);
  });

  it('changes when salient identity fields change', () => {
    const a = computeProductEvidenceHash(base);
    const b = computeProductEvidenceHash({ ...base, model: 'XM6' });
    assert.notEqual(a, b);
  });
});
