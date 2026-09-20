import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hostLabel } from './webHost';

describe('hostLabel', () => {
  it('keeps the host and drops scheme, path, query and fragment', () => {
    assert.equal(hostLabel('https://www.bose.com/p/earbuds?sku=1#reviews'), 'bose.com');
    assert.equal(hostLabel('http://techradar.com/reviews'), 'techradar.com');
  });

  it('normalises case and preserves subdomains other than www', () => {
    assert.equal(hostLabel('HTTPS://Reviews.CNET.com/audio'), 'reviews.cnet.com');
  });

  it('keeps the port when the source URL carries one', () => {
    assert.equal(hostLabel('https://example.com:8443/review'), 'example.com:8443');
  });

  it('returns null for values that are not absolute URLs', () => {
    assert.equal(hostLabel(''), null);
    assert.equal(hostLabel('   '), null);
    assert.equal(hostLabel('bose.com/p/earbuds'), null);
    assert.equal(hostLabel('https://'), null);
  });
});
