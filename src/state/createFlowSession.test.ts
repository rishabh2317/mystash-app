import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abandonCreateFlow,
  completeCreateFlow,
  exitCreateFlowAfterAbandon,
  exitCreateFlowAfterSuccess,
  getCreateFlowSessionId,
  subscribeCreateFlowSession,
} from './createFlowSession';

describe('createFlowSession', () => {
  it('increments only on complete/abandon, not on subscribe', () => {
    const before = getCreateFlowSessionId();
    const seen: number[] = [];
    const unsub = subscribeCreateFlowSession((id) => seen.push(id));
    assert.equal(getCreateFlowSessionId(), before);
    const afterPublish = completeCreateFlow();
    assert.equal(afterPublish, before + 1);
    const afterAbandon = abandonCreateFlow();
    assert.equal(afterAbandon, before + 2);
    assert.deepEqual(seen, [before + 1, before + 2]);
    unsub();
  });

  it('dismisses the Create stack then goes home after publish', () => {
    const calls: string[] = [];
    exitCreateFlowAfterSuccess({
      canDismiss: () => true,
      dismissAll: () => calls.push('dismissAll'),
      replace: (href) => calls.push(`replace:${href}`),
    });
    assert.deepEqual(calls, ['dismissAll', 'replace:/']);
  });

  it('still navigates home when there is nothing to dismiss', () => {
    const calls: string[] = [];
    exitCreateFlowAfterSuccess({
      canDismiss: () => false,
      dismissAll: () => calls.push('dismissAll'),
      replace: (href) => calls.push(`replace:${href}`),
    });
    assert.deepEqual(calls, ['replace:/']);
  });

  it('abandons to Create root without going home', () => {
    const calls: string[] = [];
    exitCreateFlowAfterAbandon({
      canDismiss: () => true,
      dismissAll: () => calls.push('dismissAll'),
      replace: (href) => calls.push(`replace:${href}`),
    });
    assert.deepEqual(calls, ['dismissAll']);
  });
});
