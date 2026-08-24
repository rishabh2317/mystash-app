import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abandonCreateFlow,
  completeCreateFlow,
  exitCreateFlowAfterAbandon,
  exitCreateFlowAfterSuccess,
  exitCreateFlowToCollection,
  exitCreateFlowToCreateAnother,
  getCreateFlowSessionId,
  subscribeCreateFlowSession,
  type CreateStackRouter,
} from './createFlowSession';

function mockRouter(calls: string[]): CreateStackRouter {
  return {
    canDismiss: () => true,
    dismissAll: () => calls.push('dismissAll'),
    replace: (href) => calls.push(`replace:${href}`),
    push: (href) => calls.push(`push:${href}`),
  };
}

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
    exitCreateFlowAfterSuccess(mockRouter(calls));
    assert.deepEqual(calls, ['dismissAll', 'replace:/']);
  });

  it('still navigates home when there is nothing to dismiss', () => {
    const calls: string[] = [];
    exitCreateFlowAfterSuccess({
      ...mockRouter(calls),
      canDismiss: () => false,
    });
    assert.deepEqual(calls, ['replace:/']);
  });

  it('opens Collection over Home so Back is not a dead end', () => {
    const calls: string[] = [];
    exitCreateFlowToCollection(mockRouter(calls), 'col-123');
    assert.deepEqual(calls, ['dismissAll', 'replace:/', 'push:/collection/col-123']);
  });

  it('falls back to feed when Collection id is missing', () => {
    const calls: string[] = [];
    exitCreateFlowToCollection(
      {
        ...mockRouter(calls),
        canDismiss: () => false,
      },
      '  ',
    );
    assert.deepEqual(calls, ['replace:/']);
  });

  it('returns to Creator Studio for Create another', () => {
    const calls: string[] = [];
    exitCreateFlowToCreateAnother(mockRouter(calls));
    assert.deepEqual(calls, ['dismissAll', 'replace:/(tabs)/create']);
  });

  it('abandons to Create root without going home', () => {
    const calls: string[] = [];
    exitCreateFlowAfterAbandon(mockRouter(calls));
    assert.deepEqual(calls, ['dismissAll']);
  });
});
