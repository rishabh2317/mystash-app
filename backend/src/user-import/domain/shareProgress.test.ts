import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shareProgressState } from './shareProgress';

describe('shareProgressState', () => {
  it('maps in-flight work to looking', () => {
    assert.equal(shareProgressState(null), 'looking');
    assert.equal(shareProgressState({ processingStatus: 'RECEIVED', candidateCount: 0 }), 'looking');
    assert.equal(shareProgressState({ processingStatus: 'QUEUED', candidateCount: 0 }), 'looking');
    assert.equal(shareProgressState({ processingStatus: 'PROCESSING', candidateCount: 0 }), 'looking');
  });

  it('maps a finished source with products to ready', () => {
    assert.equal(shareProgressState({ processingStatus: 'READY', candidateCount: 2 }), 'ready');
  });

  it('maps a finished source with no products to nothing_yet', () => {
    assert.equal(shareProgressState({ processingStatus: 'READY', candidateCount: 0 }), 'nothing_yet');
  });

  it('maps a failed source without internal error text', () => {
    assert.equal(shareProgressState({ processingStatus: 'FAILED', candidateCount: 0 }), 'couldnt_finish');
  });
});
