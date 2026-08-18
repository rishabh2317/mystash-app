import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ingestDraftNeedsProductResolve } from './ingestDraftResolveGate';

describe('ingestDraftNeedsProductResolve', () => {
  it('skips already resolved VERIFIED/UNVERIFIED catalog products', () => {
    assert.equal(
      ingestDraftNeedsProductResolve({
        catalogProductId: 'cat-1',
        resolutionStatus: 'VERIFIED',
      }),
      false,
    );
    assert.equal(
      ingestDraftNeedsProductResolve({
        catalogProductId: 'cat-2',
        resolutionStatus: 'UNVERIFIED',
      }),
      false,
    );
  });

  it('runs for genuine UNRESOLVED or missing catalog identity', () => {
    assert.equal(
      ingestDraftNeedsProductResolve({
        catalogProductId: 'placeholder',
        resolutionStatus: 'UNRESOLVED',
      }),
      true,
    );
    assert.equal(
      ingestDraftNeedsProductResolve({
        catalogProductId: null,
        resolutionStatus: 'UNRESOLVED',
      }),
      true,
    );
    assert.equal(
      ingestDraftNeedsProductResolve({
        catalogProductId: null,
        resolutionStatus: null,
      }),
      true,
    );
  });
});
