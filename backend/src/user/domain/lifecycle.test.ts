import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertAccountTransition,
  assertCreatorTransition,
  canTransitionAccount,
  canTransitionCreator,
} from './lifecycle';

describe('user lifecycle', () => {
  it('allows orthogonal account vs creator paths', () => {
    assert.equal(canTransitionAccount('ACTIVE', 'SUSPENDED'), true);
    assert.equal(canTransitionCreator('ACTIVE', 'SUSPENDED'), true);
    assert.equal(canTransitionAccount('ACTIVE', 'DELETED'), true);
    assert.equal(canTransitionCreator('NONE', 'ONBOARDING'), true);
    assert.equal(canTransitionCreator('ONBOARDING', 'ACTIVE'), true);
    assert.equal(canTransitionCreator('ONBOARDING', 'NONE'), true);
  });

  it('rejects illegal creator jumps', () => {
    assert.equal(canTransitionCreator('NONE', 'ACTIVE'), false);
    assert.throws(() => assertCreatorTransition('NONE', 'ACTIVE'));
  });

  it('rejects illegal account jumps', () => {
    assert.equal(canTransitionAccount('DELETED', 'SUSPENDED'), false);
    assert.throws(() => assertAccountTransition('DELETED', 'SUSPENDED'));
  });
});
