import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiFailure, apiFailureMessage, API_FAILURE_COPY } from './apiFailure';

describe('API failure presentation', () => {
  it('normalizes transport status and raw API messages without changing the error', () => {
    for (const error of [new Error('User API Error (502)'), {statusCode:502,message:'private upstream details'}, {status:503}, 'HTTP 500', 'Bad Gateway']) {
      assert.equal(apiFailure(error).kind, 'service');
      assert.equal(apiFailureMessage(error), API_FAILURE_COPY.service.message);
    }
    const error={statusCode:502,message:'User API Error (502)'};
    apiFailure(error);
    assert.deepEqual(error,{statusCode:502,message:'User API Error (502)'});
  });
  it('keeps actionable connection, timeout, session and access states distinct', () => {
    for (const [error,kind] of [[new TypeError('Failed to fetch'),'connection'], ['Network request failed','connection'], [{name:'TimeoutError'},'timeout'], [{status:504},'timeout'], [{status:429},'rateLimit'], [{status:401},'session'], [{status:403},'permission'], [{status:404},'missing']] as const) {
      assert.equal(apiFailure(error).kind,kind);
    }
  });
  it('stays consistent when screens store the mapped copy as a string', () => {
    for (const [kind,copy] of Object.entries(API_FAILURE_COPY)) {
      assert.equal(apiFailure(copy.message).kind,kind);
      assert.equal(apiFailureMessage(copy.message),copy.message);
    }
  });
  it('preserves validation and existing partial-product recovery guidance', () => {
    for (const message of ['Enter a valid URL.', 'Use at least 8 characters.', 'Could not extract: https://shop.example/p?ref=affiliate_code']) {
      assert.equal(apiFailureMessage(new Error(message)),message);
    }
  });
  it('hides infrastructure diagnostics and credentials', () => {
    for (const message of ['permission denied for table users', 'SQLSTATE 42501', 'PGRST116 no rows', '<html>private proxy</html>', 'Cannot read properties of undefined', 'DATABASE_ERROR private details', 'https://example.com?token=secret', 'Redis is not configured']) {
      assert.equal(apiFailureMessage(new Error(message)),API_FAILURE_COPY.unknown.message);
    }
    assert.equal(apiFailureMessage(null),API_FAILURE_COPY.unknown.message);
  });
});
