import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canMediaTransition } from './mediaLifecycle';

describe('mediaLifecycle', () => {
  it('allows imported → processing → ready', () => {
    assert.equal(canMediaTransition('imported', 'processing'), true);
    assert.equal(canMediaTransition('processing', 'ready'), true);
  });

  it('allows imported → ready for light paths', () => {
    assert.equal(canMediaTransition('imported', 'ready'), true);
  });

  it('allows failed → processing retry', () => {
    assert.equal(canMediaTransition('failed', 'processing'), true);
  });

  it('rejects archived → ready', () => {
    assert.equal(canMediaTransition('archived', 'ready'), false);
  });
});
