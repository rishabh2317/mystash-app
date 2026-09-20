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
  groupBagItems,
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

describe('Bag presentation', () => {
  it('renders a canonical Bag item without verification internals', () => {
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
    assert.equal(view.sourceLabel, 'From a collection');
    assert.equal(view.canBuy, true);
    assert.equal(view.catalogProductId, 'cat-1');
    assert.equal('verificationStatus' in view, false);
    assert.equal('metadataCompleteness' in view, false);
  });

  it('renders a discovered Bag item through the same view and shows price', () => {
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
    assert.equal(view.sourceLabel, 'From a shared link');
    assert.equal(view.contentSourceId, 'cs-1');
    assert.equal(view.userImportId, 'imp-1');
    assert.doesNotMatch(view.title, FORBIDDEN_COPY);
    assert.doesNotMatch(view.sourceLabel ?? '', FORBIDDEN_COPY);
  });

  it('groups a mixed canonical + discovered Bag by category', () => {
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

  it('keeps duplicate product ids unique at the Bag view layer', () => {
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
    assert.equal(bagSourceLabel(view.source), 'From a shared link');
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

  it('Bag UI does not use ProductCard or expose internal status copy', () => {
    const cart = readFileSync(join(ROOT, 'app/cart.tsx'), 'utf8');
    const card = readFileSync(join(ROOT, 'components/commerce/BagItemCard.tsx'), 'utf8');
    assert.match(cart, /BagItemCard/);
    assert.match(cart, /productPagePath/);
    assert.match(cart, /fetchImportShares/);
    assert.doesNotMatch(cart, /ProductCard/);
    assert.doesNotMatch(cart, /ProductDetailsSheet/);
    assert.doesNotMatch(cart, /VerificationBadge/);
    assert.doesNotMatch(card, /VerificationBadge/);
  });
});
