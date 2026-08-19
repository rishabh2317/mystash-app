import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCatalogStatusTransition,
  statusAfterLifecycleAction,
} from './lifecycle';

describe('catalog lifecycle', () => {
  it('allows ACTIVE → HIDDEN → ACTIVE', () => {
    assertCatalogStatusTransition('ACTIVE', 'HIDDEN');
    assertCatalogStatusTransition('HIDDEN', 'ACTIVE');
  });

  it('rejects transitions out of MERGED', () => {
    assert.throws(() => assertCatalogStatusTransition('MERGED', 'ACTIVE'));
  });

  it('maps lifecycle actions', () => {
    assert.equal(statusAfterLifecycleAction('ACTIVE', 'hide'), 'HIDDEN');
    assert.equal(statusAfterLifecycleAction('HIDDEN', 'unhide'), 'ACTIVE');
    assert.equal(statusAfterLifecycleAction('ACTIVE', 'discontinue'), 'DISCONTINUED');
    assert.equal(statusAfterLifecycleAction('DISCONTINUED', 'restore'), 'ACTIVE');
  });

  it('rejects lifecycle on MERGED', () => {
    assert.throws(() => statusAfterLifecycleAction('MERGED', 'hide'));
  });
});
