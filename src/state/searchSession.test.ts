import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldResetSearchSession } from './searchSession';

describe('shouldResetSearchSession', () => {
  it('does not reset on first mount', () => {
    assert.equal(shouldResetSearchSession(null, '/search'), false);
  });

  it('resets when entering Search from Home or Create (fresh session)', () => {
    assert.equal(shouldResetSearchSession('/', '/search'), true);
    assert.equal(shouldResetSearchSession('/create', '/search'), true);
    assert.equal(shouldResetSearchSession('/create/review', '/search'), true);
    assert.equal(shouldResetSearchSession('/profile', '/search'), true);
  });

  it('keeps query/results when returning from a Search-flow detail', () => {
    assert.equal(shouldResetSearchSession('/collection/col-1', '/search'), false);
    assert.equal(shouldResetSearchSession('/creator/ada', '/search'), false);
    assert.equal(shouldResetSearchSession('/reel/col-1', '/search'), false);
    assert.equal(shouldResetSearchSession('/reel/search/col-1', '/search'), false);
    assert.equal(shouldResetSearchSession('/cart', '/search'), false);
  });

  it('does not reset while remaining on Search or leaving Search', () => {
    assert.equal(shouldResetSearchSession('/search', '/search'), false);
    assert.equal(shouldResetSearchSession('/search', '/'), false);
    assert.equal(shouldResetSearchSession('/search', '/collection/col-1'), false);
  });
});
