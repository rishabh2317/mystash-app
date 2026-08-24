import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeProductIdentityTokens } from './ProductIdentityCanonicalizer';

describe('normalizeProductIdentityTokens', () => {
  it('splits 15-inch and keeps chip tokens such as M4', () => {
    const tokens = normalizeProductIdentityTokens('Apple MacBook Air 15-inch M4').map((t) =>
      t.toLowerCase(),
    );
    assert.ok(tokens.includes('15'));
    assert.ok(tokens.includes('m4'));
    assert.ok(tokens.includes('macbook'));
    assert.equal(tokens.includes('15-inch'), false);
  });
});
