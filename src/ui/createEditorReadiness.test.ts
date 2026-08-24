import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DraftProduct } from '../types/curation';
import {
  buildEditorReadiness,
  contentPlatformLabel,
  productsSectionMetaLabel,
} from './createEditorReadiness';

function product(
  partial: Partial<DraftProduct> & { id: string },
): DraftProduct {
  return {
    id: partial.id,
    name: partial.name ?? 'Item',
    price: partial.price ?? '—',
    provider: partial.provider ?? 'manual',
    affiliateUrl: partial.affiliateUrl ?? '',
    catalogProductId: partial.catalogProductId,
    resolutionStatus: partial.resolutionStatus,
  };
}

describe('UX-CREATE-B.5 editor readiness', () => {
  it('requires content, at least one included product, and no resolving blockers', () => {
    const products = [
      product({ id: 'a', catalogProductId: 'c1', resolutionStatus: 'VERIFIED' }),
      product({ id: 'b', resolutionStatus: undefined }),
    ];
    const notReady = buildEditorReadiness({
      hasContent: true,
      products,
      selected: { a: false, b: true },
    });
    assert.equal(notReady.ready, false);
    assert.equal(notReady.items.find((i) => i.id === 'products')?.done, true);
    assert.equal(notReady.items.find((i) => i.id === 'resolving')?.done, false);
    assert.equal(notReady.attentionCount, 1);

    const ready = buildEditorReadiness({
      hasContent: true,
      products,
      selected: { a: true, b: false },
    });
    assert.equal(ready.ready, true);
    assert.equal(ready.includedCount, 1);
    assert.equal(ready.attentionCount, 0);
  });

  it('fails readiness without content or without included products', () => {
    const products = [
      product({ id: 'a', catalogProductId: 'c1', resolutionStatus: 'VERIFIED' }),
    ];
    assert.equal(
      buildEditorReadiness({ hasContent: false, products, selected: { a: true } }).ready,
      false,
    );
    assert.equal(
      buildEditorReadiness({ hasContent: true, products, selected: { a: false } }).ready,
      false,
    );
  });

  it('formats products section meta and content platform labels', () => {
    assert.equal(productsSectionMetaLabel(0, 0), 'None included yet');
    assert.equal(productsSectionMetaLabel(3, 1), '3 included · 1 needs attention');
    assert.equal(contentPlatformLabel('youtube'), 'YouTube Short');
    assert.equal(contentPlatformLabel('instagram'), 'Instagram Reel');
  });
});
