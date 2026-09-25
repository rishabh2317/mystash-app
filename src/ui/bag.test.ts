import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { CartLine } from '@/src/services/cartLineMap';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import {
  BAG_PROGRESS_COPY,
  bagHasInFlightShares,
  bagItemFromLine,
  bagProgressBanners,
  bagSections,
  bagSourceLabel,
  buildStashHome,
  formatStashCategoryTitle,
  groupBagItems,
  stashContextLabel,
  stashRelativeTime,
  uniqueBagProductIds,
  type BagItemView,
} from '@/src/ui/bag';

const ROOT = process.cwd();

const FORBIDDEN_COPY =
  /discovered product|unverified|confidence|completeness|catalogue status|catalog status|ai status|processingStatus|queued|resolver/i;

function product(
  id: string,
  overrides: Partial<CatalogProductViewModel> = {},
): CatalogProductViewModel {
  return {
    id,
    catalogProductId: id,
    title: 'Item',
    brand: null,
    merchant: null,
    heroImage: 'https://cdn.example.com/p.jpg',
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNVERIFIED',
    availability: null,
    price: null,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: 0.4,
    category: null,
    ...overrides,
  };
}

function line(partial: Partial<CartLine> & Pick<CartLine, 'cartItemId' | 'productId'>): CartLine {
  return {
    catalogProductId: null,
    addedAt: '2026-09-20T12:00:00.000Z',
    availability: 'NO_DESTINATION',
    product: null,
    source: null,
    ...partial,
  };
}

describe('Stash presentation', () => {
  it('renders a canonical Stash item without verification internals', () => {
    const view = bagItemFromLine(
      line({
        cartItemId: 'c1',
        productId: 'cat-1',
        catalogProductId: 'cat-1',
        availability: 'AVAILABLE',
        addedAt: '2026-09-20T10:00:00.000Z',
        product: product('cat-1', {
          title: 'WH-1000XM5',
          brand: 'Sony',
          price: '299.00',
          currency: 'USD',
          category: 'Audio',
          verificationStatus: 'VERIFIED',
          metadataCompleteness: 0.9,
        }),
        source: { surface: 'COLLECTION', collectionId: 'col-1' },
      }),
    );
    assert.equal(view.title, 'WH-1000XM5');
    assert.equal(view.brand, 'Sony');
    assert.equal(view.priceLabel, 'USD 299.00');
    assert.equal(view.category, 'Audio');
    assert.equal(view.sourceLabel, 'Collection');
    assert.equal(view.canBuy, true);
    assert.equal(view.catalogProductId, 'cat-1');
    assert.equal('verificationStatus' in view, false);
    assert.equal('metadataCompleteness' in view, false);
  });

  it('renders a discovered Stash item through the same view and shows price', () => {
    const view = bagItemFromLine(
      line({
        cartItemId: 'c2',
        productId: 'disc-1',
        catalogProductId: null,
        availability: 'NO_DESTINATION',
        product: product('disc-1', {
          catalogProductId: null,
          title: 'Ceramic mug',
          brand: 'Acme',
          price: '12.00',
          currency: 'USD',
          category: 'Home',
          verificationStatus: 'UNVERIFIED',
        }),
        source: {
          surface: 'USER_IMPORT',
          contentSourceId: 'cs-1',
          userImportId: 'imp-1',
        },
      }),
    );
    assert.equal(view.title, 'Ceramic mug');
    assert.equal(view.brand, 'Acme');
    assert.equal(view.priceLabel, 'USD 12.00');
    assert.equal(view.canBuy, false);
    assert.equal(view.catalogProductId, null);
    assert.equal(view.sourceLabel, 'Shared');
    assert.equal(view.contentSourceId, 'cs-1');
    assert.equal(view.userImportId, 'imp-1');
    assert.doesNotMatch(view.title, FORBIDDEN_COPY);
    assert.doesNotMatch(view.sourceLabel ?? '', FORBIDDEN_COPY);
  });

  it('groups a mixed canonical + discovered Stash by category', () => {
    const items: BagItemView[] = [
      bagItemFromLine(
        line({
          cartItemId: 'c1',
          productId: 'cat-1',
          catalogProductId: 'cat-1',
          addedAt: '2026-09-20T11:00:00.000Z',
          product: product('cat-1', { title: 'Headphones', category: 'Audio' }),
        }),
      ),
      bagItemFromLine(
        line({
          cartItemId: 'c2',
          productId: 'disc-1',
          addedAt: '2026-09-20T12:00:00.000Z',
          product: product('disc-1', {
            catalogProductId: null,
            title: 'Mug',
            category: 'Home',
          }),
        }),
      ),
      bagItemFromLine(
        line({
          cartItemId: 'c3',
          productId: 'cat-2',
          catalogProductId: 'cat-2',
          addedAt: '2026-09-20T09:00:00.000Z',
          product: product('cat-2', { title: 'Cable', category: null }),
        }),
      ),
    ];
    const grouped = groupBagItems(items);
    assert.deepEqual(
      grouped.map((group) => group.title),
      ['Audio', 'Home', 'Other'],
    );
    assert.equal(uniqueBagProductIds(items).length, 3);
    assert.deepEqual(
      bagSections(items).map((group) => group.key),
      ['Audio', 'Home', 'Other'],
    );
  });

  it('builds Stash home with category cards and recent finds — no Ready to shop', () => {
    const items = [
      bagItemFromLine(
        line({
          cartItemId: 'c1',
          productId: 'cat-1',
          catalogProductId: 'cat-1',
          availability: 'AVAILABLE',
          addedAt: '2026-09-22T12:00:00.000Z',
          product: product('cat-1', { title: 'Phone', category: 'electronics' }),
        }),
      ),
      bagItemFromLine(
        line({
          cartItemId: 'c2',
          productId: 'cat-2',
          catalogProductId: 'cat-2',
          availability: 'AVAILABLE',
          addedAt: '2026-09-21T12:00:00.000Z',
          product: product('cat-2', { title: 'Case', category: 'electronics' }),
        }),
      ),
      bagItemFromLine(
        line({
          cartItemId: 'c3',
          productId: 'disc-1',
          catalogProductId: null,
          availability: 'NO_DESTINATION',
          addedAt: '2026-09-20T12:00:00.000Z',
          product: product('disc-1', {
            catalogProductId: null,
            title: 'Mug',
            category: 'Home',
          }),
        }),
      ),
    ];
    const layout = buildStashHome(items);
    assert.equal(layout.countLabel, '3 stashed');
    assert.deepEqual(
      layout.categories.map((category) => category.key),
      ['electronics', 'Home'],
    );
    assert.equal(layout.categories[0]?.title, 'Electronics');
    assert.equal(layout.categories[0]?.count, 2);
    assert.equal(layout.categories[0]?.previewUrls.length, 2);
    assert.equal(layout.recent[0]?.title, 'Phone');
    assert.equal(layout.recent.length, 3);
    assert.equal(
      layout.categories.some((category) => /ready/i.test(category.title)),
      false,
    );
  });

  it('skips empty Ready semantics and still shows uncategorized as Other', () => {
    const items = [
      bagItemFromLine(
        line({
          cartItemId: 'c1',
          productId: 'disc-1',
          catalogProductId: null,
          availability: 'NO_DESTINATION',
          product: product('disc-1', { catalogProductId: null, category: null }),
        }),
      ),
    ];
    const layout = buildStashHome(items);
    assert.deepEqual(
      layout.categories.map((category) => category.key),
      ['Other'],
    );
    assert.equal(layout.recent.length, 1);
  });

  it('formats quiet memory context from source + addedAt', () => {
    const now = Date.parse('2026-09-22T14:00:00.000Z');
    assert.equal(stashRelativeTime('2026-09-22T12:00:00.000Z', now), '2h ago');
    assert.equal(stashRelativeTime('2026-09-21T14:00:00.000Z', now), 'yesterday');
    assert.equal(
      stashContextLabel(
        {
          source: { surface: 'USER_IMPORT' },
          addedAt: '2026-09-22T12:00:00.000Z',
        },
        now,
      ),
      'Shared · 2h ago',
    );
    assert.equal(formatStashCategoryTitle('electronics'), 'Electronics');
  });

  it('skips a category header when nothing is categorized', () => {
    const items = [
      bagItemFromLine(
        line({
          cartItemId: 'c1',
          productId: 'cat-1',
          catalogProductId: 'cat-1',
          product: product('cat-1', { category: null }),
        }),
      ),
    ];
    const sections = bagSections(items);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.title, '');
  });

  it('keeps duplicate product ids unique at the Stash view layer', () => {
    const items = [
      bagItemFromLine(
        line({
          cartItemId: 'c1',
          productId: 'cat-1',
          catalogProductId: 'cat-1',
          product: product('cat-1'),
        }),
      ),
      bagItemFromLine(
        line({
          cartItemId: 'c1-dup',
          productId: 'cat-1',
          catalogProductId: 'cat-1',
          product: product('cat-1'),
        }),
      ),
    ];
    assert.deepEqual(uniqueBagProductIds(items), ['cat-1']);
  });

  it('preserves source attribution for a later Product Page', () => {
    const view = bagItemFromLine(
      line({
        cartItemId: 'c2',
        productId: 'disc-1',
        source: {
          surface: 'USER_IMPORT',
          contentSourceId: 'cs-9',
          userImportId: 'imp-9',
        },
        product: product('disc-1', { catalogProductId: null }),
      }),
    );
    assert.equal(view.source?.surface, 'USER_IMPORT');
    assert.equal(view.source?.contentSourceId, 'cs-9');
    assert.equal(view.source?.userImportId, 'imp-9');
    assert.equal(bagSourceLabel(view.source), 'Shared');
  });

  it('maps share progress to user-facing banners', () => {
    assert.deepEqual(
      bagProgressBanners([{ importId: 'i1', state: 'looking', kind: 'instagram' }]).map(
        (banner) => banner.message,
      ),
      [BAG_PROGRESS_COPY.lookingReel],
    );
    assert.equal(bagHasInFlightShares([{ importId: 'i1', state: 'looking', kind: 'web' }]), true);
    const mixed = bagProgressBanners([
      { importId: 'i1', state: 'looking', kind: 'web' },
      { importId: 'i2', state: 'nothing_yet', kind: 'youtube' },
      { importId: 'i3', state: 'ready', kind: 'web' },
      { importId: 'i4', state: 'couldnt_finish', kind: 'web' },
    ]);
    assert.equal(mixed.some((banner) => banner.tone === 'looking'), true);
    assert.equal(mixed.some((banner) => banner.message === BAG_PROGRESS_COPY.nothingYet), true);
    assert.equal(mixed.some((banner) => banner.message === BAG_PROGRESS_COPY.couldntFinish), true);
    assert.equal(mixed.some((banner) => banner.message === BAG_PROGRESS_COPY.lookingMany), false);
    for (const copy of Object.values(BAG_PROGRESS_COPY)) {
      assert.doesNotMatch(copy, FORBIDDEN_COPY);
    }
  });

  it('stops in-flight discovery polling once shares are ready', () => {
    assert.equal(
      bagHasInFlightShares([
        { importId: 'i1', state: 'ready', kind: 'youtube' },
        { importId: 'i2', state: 'nothing_yet', kind: 'web' },
      ]),
      false,
    );
    assert.equal(bagProgressBanners([{ importId: 'i1', state: 'ready', kind: 'youtube' }]).length, 0);
  });

  it('groups unknown categories under Other and keeps mapped categories', () => {
    const sections = groupBagItems([
      {
        cartItemId: 'c1',
        productId: 'p1',
        catalogProductId: null,
        addedAt: '2026-09-20T12:00:00.000Z',
        title: 'Phone',
        brand: null,
        priceLabel: null,
        imageUrl: 'https://cdn.example.com/p.jpg',
        category: 'electronics',
        sourceLabel: null,
        availabilityLabel: null,
        canBuy: false,
        source: null,
        contentSourceId: null,
        userImportId: null,
        product: product('p1', { category: 'electronics' }),
      },
      {
        cartItemId: 'c2',
        productId: 'p2',
        catalogProductId: null,
        addedAt: '2026-09-20T12:00:00.000Z',
        title: 'Odd',
        brand: null,
        priceLabel: null,
        imageUrl: 'https://cdn.example.com/p.jpg',
        category: 'unknown',
        sourceLabel: null,
        availabilityLabel: null,
        canBuy: false,
        source: null,
        contentSourceId: null,
        userImportId: null,
        product: product('p2', { category: 'unknown' }),
      },
    ]);
    assert.equal(sections[0]?.title, 'electronics');
    assert.equal(sections.some((s) => /unknown/i.test(s.title)), false);
    assert.ok(sections.some((s) => s.title === 'Other'));
  });

  it('Stash category collage keeps transparent gutters between curved thumbnails', () => {
    const src = readFileSync(join(ROOT, 'components/commerce/StashCategoryCard.tsx'), 'utf8');
    assert.match(src, /COLLAGE_GUTTER/);
    assert.match(src, /borderTopLeftRadius: collageRadius/);
    assert.match(src, /borderTopRightRadius: collageRadius/);
    assert.match(src, /borderBottomLeftRadius: collageRadius/);
    assert.match(src, /borderBottomRightRadius: collageRadius/);
    assert.match(src, /outlineCardChrome\(tokens\)/);
    assert.match(src, /semantic\.surface\.outlineCard/);
    assert.match(src, /styles\.row/);
  });

  it('Stash UI uses category cards + collection ProductCards, not Ready to shop', () => {
    const cart = readFileSync(join(ROOT, 'app/(tabs)/stash.tsx'), 'utf8');
    assert.match(cart, /StashCategoryCard/);
    assert.match(cart, /ProductCard/);
    assert.match(cart, /variant=\"related\"/);
    assert.match(cart, /buildStashHome/);
    assert.match(cart, /Your products/);
    assert.match(cart, /renderRelatedGrid/);
    assert.match(cart, /trash-outline/);
    assert.match(cart, /!item\.catalogProductId/);
    assert.doesNotMatch(cart, />\s*Remove\s*</);
    assert.match(cart, /onBecameReady/);
    assert.match(cart, /useFocusEffect/);
    assert.match(cart, /void refresh\(\)/);
    assert.doesNotMatch(cart, /ContentRail/);
    assert.doesNotMatch(cart, /variant=\"collection\"/);
    assert.doesNotMatch(cart, /Ready to shop/);
    assert.doesNotMatch(cart, /bagProgressBanners/);
    assert.doesNotMatch(cart, /BagItemCard/);
    assert.doesNotMatch(cart, /ProductDetailsSheet/);
  });
});
