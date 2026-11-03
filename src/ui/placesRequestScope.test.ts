import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPlacesRequestScope } from './placesRequestScope';

it('ignores older success/error responses after a newer refresh or blur', () => {
  const scope = createPlacesRequestScope();
  scope.setAccount('a');
  const old = scope.begin();
  const current = scope.begin();
  assert.equal(scope.isCurrent(old), false);
  assert.equal(scope.isCurrent(current), true);
  scope.invalidate();
  assert.equal(scope.isCurrent(current), false);
});

it('rejects requests from a previous account even after signing back into it', () => {
  const scope = createPlacesRequestScope();
  scope.setAccount('a');
  const old = scope.begin();
  scope.setAccount(undefined);
  assert.equal(scope.isCurrent(old), false);
  scope.setAccount('b');
  assert.equal(scope.isCurrent(old), false);
  scope.setAccount('a');
  assert.equal(scope.isCurrent(old), false);
  assert.equal(scope.isCurrent(scope.begin()), true);
});
