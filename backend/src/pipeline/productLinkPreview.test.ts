import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clearLiveProductPreviewMemoForTests,
  getLiveProductPreview,
  isRichProductPreview,
  rememberLiveProductPreview,
  shouldUseCanonicalCacheHit,
  type ProductLinkPreview,
} from './productLinkPreview';

const rich: ProductLinkPreview = {
  externalId: 'ext',
  name: 'Xbox Series S',
  price: '₹66,999.00',
  currency: 'INR',
  image: 'https://img.example/xbox.jpg',
  merchantUrl: 'https://amzn.in/d/01fhRXW8',
  merchant: 'amzn.in',
  brand: 'Microsoft',
  description: 'All-digital next-gen gaming console with 1TB storage.',
  specifications: { Storage: '1TB', Color: 'White' },
};

const partial: ProductLinkPreview = {
  externalId: 'ext',
  name: 'Xbox Series S',
  price: '₹66,999.00',
  currency: 'INR',
  image: 'https://img.example/xbox.jpg',
  merchantUrl: 'https://amzn.in/d/01fhRXW8',
  merchant: 'amzn.in',
};

describe('canonical preview richness', () => {
  afterEach(() => {
    clearLiveProductPreviewMemoForTests();
  });

  it('treats name/price/image-only rows as not rich', () => {
    assert.equal(isRichProductPreview(partial), false);
    assert.equal(isRichProductPreview(rich), true);
    assert.equal(isRichProductPreview({ brand: 'Microsoft' }), true);
    assert.equal(isRichProductPreview({ description: 'A'.repeat(20) }), true);
    assert.equal(isRichProductPreview({ specifications: { Color: 'White' } }), true);
  });

  it('keeps using partial cache for default (YouTube/Instagram) callers', () => {
    assert.equal(shouldUseCanonicalCacheHit(partial, undefined), true);
    assert.equal(shouldUseCanonicalCacheHit(partial, true), true);
  });

  it('skips partial cache when the caller requires richer evidence', () => {
    assert.equal(shouldUseCanonicalCacheHit(partial, false), false);
    assert.equal(shouldUseCanonicalCacheHit(rich, false), true);
  });

  it('remembers rich live previews so a later read does not use a weaker cache row', () => {
    rememberLiveProductPreview(rich.merchantUrl, rich);
    assert.equal(
      getLiveProductPreview(rich.merchantUrl)?.description,
      rich.description,
    );
    assert.equal(
      getLiveProductPreview(rich.merchantUrl)?.specifications?.Storage,
      '1TB',
    );
  });

  it('does not remember a name/price/image-only preview as live evidence', () => {
    rememberLiveProductPreview(partial.merchantUrl, partial);
    assert.equal(getLiveProductPreview(partial.merchantUrl), undefined);
  });
});
