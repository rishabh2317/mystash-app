import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublishConfirmSummary,
  publishProductCountLabel,
  resolvePublishSuccessCollectionId,
} from './createPublishRitual';

describe('UX-CREATE-B.7 publish ritual', () => {
  it('builds confirm summary with fallback title and product count', () => {
    const empty = buildPublishConfirmSummary({
      title: '  ',
      productCount: 3,
      previewLine: 'Live soon',
    });
    assert.equal(empty.title, 'Untitled Collection');
    assert.equal(empty.productCount, 3);
    assert.equal(empty.thumbnailUrl, undefined);

    const full = buildPublishConfirmSummary({
      title: 'Summer fits',
      productCount: 2,
      thumbnailUrl: 'https://img.example/t.jpg',
      previewLine: 'Live soon',
    });
    assert.equal(full.title, 'Summer fits');
    assert.equal(full.thumbnailUrl, 'https://img.example/t.jpg');
  });

  it('formats product count labels', () => {
    assert.equal(publishProductCountLabel(1), '1 product');
    assert.equal(publishProductCountLabel(4), '4 products');
  });

  it('resolves Collection id only when present', () => {
    assert.equal(resolvePublishSuccessCollectionId(null), null);
    assert.equal(resolvePublishSuccessCollectionId('  '), null);
    assert.equal(resolvePublishSuccessCollectionId(' col-1 '), 'col-1');
  });
});
