import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ImportShare } from '@/src/services/importShareMap';
import {
  shareActivityDestination,
  shareActivityLandingItems,
  shareActivityRelativeTime,
  shareActivityUserState,
} from '@/src/ui/shareActivity';

const ROOT = process.cwd();

function share(partial: Partial<ImportShare> & Pick<ImportShare, 'importId' | 'state'>): ImportShare {
  return {
    kind: 'web',
    createdAt: '2026-09-22T10:00:00.000Z',
    productCount: 0,
    contentSourceId: null,
    sourceUrl: 'https://example.com/x',
    primaryProduct: null,
    products: [],
    ...partial,
  };
}

describe('shareActivityUserState', () => {
  it('maps wire states to user-facing labels without internals', () => {
    assert.equal(shareActivityUserState('looking'), 'processing');
    assert.equal(shareActivityUserState('ready'), 'products_found');
    assert.equal(shareActivityUserState('nothing_yet'), 'no_products');
    assert.equal(shareActivityUserState('couldnt_finish'), 'failed');
  });
});

describe('shareActivityLandingItems', () => {
  it('shows only the newest looking import when any are active', () => {
    const items = shareActivityLandingItems([
      share({ importId: 'old', state: 'looking', createdAt: '2026-09-22T09:00:00.000Z' }),
      share({ importId: 'new', state: 'looking', createdAt: '2026-09-22T11:00:00.000Z' }),
      share({
        importId: 'done',
        state: 'ready',
        createdAt: '2026-09-22T12:00:00.000Z',
        productCount: 1,
      }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.importId, 'new');
    assert.equal(items[0]?.userState, 'processing');
  });

  it('shows only the latest terminal share when none are looking', () => {
    const items = shareActivityLandingItems([
      share({ importId: 'a', state: 'ready', createdAt: '2026-09-22T12:00:00.000Z', productCount: 1 }),
      share({ importId: 'b', state: 'nothing_yet', createdAt: '2026-09-22T11:00:00.000Z' }),
      share({ importId: 'c', state: 'couldnt_finish', createdAt: '2026-09-22T10:00:00.000Z' }),
      share({ importId: 'd', state: 'ready', createdAt: '2026-09-22T09:00:00.000Z', productCount: 2 }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.importId, 'a');
  });

  it('returns empty when there is no history', () => {
    assert.equal(shareActivityLandingItems([]).length, 0);
  });
});

describe('shareActivityDestination', () => {
  it('routes exactly one product to the Product Page', () => {
    const dest = shareActivityDestination(
      share({
        importId: 'i1',
        state: 'ready',
        productCount: 1,
        contentSourceId: 'cs1',
        primaryProduct: {
          productId: 'p1',
          title: 'Mug',
          imageUrl: null,
        },
      }),
    );
    assert.equal(dest.kind, 'product');
    if (dest.kind === 'product') {
      assert.match(dest.path, /\/product\/p1/);
      assert.match(dest.path, /contentSourceId=cs1/);
      assert.match(dest.path, /userImportId=i1/);
    }
  });

  it('routes two or more products to Bag, never primary product', () => {
    const dest = shareActivityDestination(
      share({
        importId: 'i2',
        state: 'ready',
        productCount: 2,
        primaryProduct: {
          productId: 'p1',
          title: 'Mug',
          imageUrl: null,
        },
      }),
    );
    assert.deepEqual(dest, { kind: 'bag', path: '/cart' });
  });

  it('does not invent a product route for failed or empty outcomes', () => {
    assert.deepEqual(
      shareActivityDestination(share({ importId: 'x', state: 'nothing_yet' })),
      { kind: 'none' },
    );
    assert.deepEqual(
      shareActivityDestination(share({ importId: 'y', state: 'couldnt_finish' })),
      { kind: 'none' },
    );
  });

  it('sends looking shares to Bag', () => {
    assert.deepEqual(
      shareActivityDestination(share({ importId: 'z', state: 'looking' })),
      { kind: 'bag', path: '/cart' },
    );
  });
});

describe('shareActivityRelativeTime', () => {
  it('formats compact relative labels', () => {
    const now = Date.parse('2026-09-22T12:00:00.000Z');
    assert.equal(shareActivityRelativeTime('2026-09-22T11:59:30.000Z', now), 'Just now');
    assert.equal(shareActivityRelativeTime('2026-09-22T11:30:00.000Z', now), '30m ago');
    assert.equal(shareActivityRelativeTime('2026-09-22T09:00:00.000Z', now), '3h ago');
  });
});

describe('shareActivity source boundaries', () => {
  it('does not import content-source internals', () => {
    const code = readFileSync(join(ROOT, 'src/ui/shareActivity.ts'), 'utf8');
    assert.doesNotMatch(code, /ContentProcessingStatus|QUEUED|ContentSourceService/);
    assert.doesNotMatch(code, /from ['"]@\/backend/);
  });
});
