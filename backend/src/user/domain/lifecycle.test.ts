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
    assert.equal(canTransitionCreator('ACTIVE', 'ONBOARDING'), false);
    assert.equal(canTransitionCreator('NONE', 'SUSPENDED'), false);
    assert.equal(canTransitionCreator('ONBOARDING', 'SUSPENDED'), false);
    assert.throws(() => assertCreatorTransition('NONE', 'ACTIVE'));
  });

  it('rejects illegal account jumps', () => {
    assert.equal(canTransitionAccount('DELETED', 'SUSPENDED'), false);
    assert.throws(() => assertAccountTransition('DELETED', 'SUSPENDED'));
  });
});
