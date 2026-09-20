import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalizeProductUrl, externalIdForProductUrl } from '../../pipeline/urlCanonicalization';
import { discoveredProductIdentityKey } from './identity';

describe('discoveredProductIdentityKey', () => {
  it('reuses product-URL identity when a merchant URL is present', () => {
    const url = 'https://www.shop.example/p/mug?utm_source=ig';
    assert.equal(
      discoveredProductIdentityKey(
        { normalizedName: 'mug', normalizedBrand: 'acme', model: null },
        url,
      ),
      externalIdForProductUrl(canonicalizeProductUrl(url)),
    );
  });

  it('falls back to a stable name+brand+model hash', () => {
    const a = discoveredProductIdentityKey({
      normalizedName: 'mystery gadget',
      normalizedBrand: 'acme',
      model: 'GX1',
    });
    const b = discoveredProductIdentityKey({
      normalizedName: 'mystery gadget',
      normalizedBrand: 'acme',
      model: 'GX1',
    });
    assert.equal(a, b);
    assert.match(a, /^n_[a-f0-9]{28}$/);
  });
});
