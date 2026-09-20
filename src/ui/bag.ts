import type { CartItemSource, CartLine } from '@/src/services/cartLineMap';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import { formatProductPrice } from '@/src/ui/collectionSections';

/** One Bag row. Canonical and discovered products share this shape. */
export type BagItemView = {
  cartItemId: string;
  productId: string;
  catalogProductId: string | null;
  addedAt: string;
  title: string;
  brand: string | null;
  priceLabel: string | null;
  imageUrl: string | null;
  category: string | null;
  sourceLabel: string | null;
  availabilityLabel: string | null;
  canBuy: boolean;
  source: CartItemSource | null;
  contentSourceId: string | null;
  userImportId: string | null;
  product: CatalogProductViewModel;
};

export type BagCategoryGroup = {
  key: string;
  title: string;
  items: BagItemView[];
};

export type BagShareState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

export type BagShare = {
  importId: string;
  state: BagShareState;
  kind?: 'instagram' | 'youtube' | 'web';
};

export const BAG_PROGRESS_COPY = {
  looking: 'Finding products from your link…',
  lookingReel: 'Finding products from your Reel…',
  lookingShort: 'Finding products from your Short…',
  lookingMany: 'Finding products from your links…',
  nothingYet: "We couldn't find products in that link yet.",
  couldntFinish: "We couldn't finish that link. Try sharing it again.",
  emptyHint: 'Products you save will show up here.',
} as const;

export const OTHER_BAG_CATEGORY = 'Other';

export function bagSourceLabel(source: CartItemSource | null | undefined): string | null {
  switch (source?.surface) {
    case 'USER_IMPORT':
      return 'From a shared link';
    case 'COLLECTION':
      return 'From a collection';
    case 'SEARCH':
      return 'From search';
    case 'PRODUCT_DETAILS':
      return 'From a product';
    default:
      return null;
  }
}

export function bagAvailabilityLabel(
  availability: CartLine['availability'],
): string | null {
  if (availability === 'NO_DESTINATION') return 'Shopping link unavailable';
  if (availability === 'UNAVAILABLE') return 'Unavailable';
  return null;
}

export function bagItemFromLine(line: CartLine): BagItemView {
  const product = line.product ?? {
    id: line.productId,
    catalogProductId: line.catalogProductId,
    title: 'Saved item',
    brand: null,
    merchant: null,
    heroImage: CATALOG_IMAGE_PLACEHOLDER,
    galleryImages: [],
    description: null,
    shortDescription: null,
    specifications: {},
    verificationStatus: 'UNRESOLVED',
    availability: line.availability,
    price: null,
    currency: null,
    lastVerifiedAt: null,
    metadataCompleteness: null,
    category: null,
  };
  const category = product.category?.trim() || null;
  return {
    cartItemId: line.cartItemId,
    productId: line.productId,
    catalogProductId: line.catalogProductId,
    addedAt: line.addedAt,
    title: product.title,
    brand: product.brand,
    priceLabel: formatProductPrice(product),
    imageUrl: product.heroImage,
    category,
    sourceLabel: bagSourceLabel(line.source),
    availabilityLabel: bagAvailabilityLabel(line.availability),
    canBuy: line.availability === 'AVAILABLE' && Boolean(line.catalogProductId),
    source: line.source,
    contentSourceId: line.source?.contentSourceId ?? null,
    userImportId: line.source?.userImportId ?? null,
    product: {
      ...product,
      catalogProductId: line.catalogProductId,
    },
  };
}

export function groupBagItems(items: BagItemView[]): BagCategoryGroup[] {
  const buckets = new Map<string, BagItemView[]>();
  for (const item of items) {
    const key = item.category ?? OTHER_BAG_CATEGORY;
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const named = [...buckets.entries()].filter(([key]) => key !== OTHER_BAG_CATEGORY);
  named.sort(([a], [b]) => a.localeCompare(b));
  const other = buckets.get(OTHER_BAG_CATEGORY);
  const ordered: BagCategoryGroup[] = named.map(([key, groupItems]) => ({
    key,
    title: key,
    items: sortBagItems(groupItems),
  }));
  if (other?.length) {
    ordered.push({ key: OTHER_BAG_CATEGORY, title: OTHER_BAG_CATEGORY, items: sortBagItems(other) });
  }
  return ordered;
}

function sortBagItems(items: BagItemView[]): BagItemView[] {
  return [...items].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
}

/** Named categories become section headers; uncategorized-only lists skip “Other”. */
export function bagSections(items: BagItemView[]): BagCategoryGroup[] {
  const groups = groupBagItems(items);
  const hasNamed = groups.some((group) => group.key !== OTHER_BAG_CATEGORY);
  if (!hasNamed) {
    return [{ key: 'all', title: '', items: sortBagItems(items) }];
  }
  return groups;
}

export function bagProgressBanners(shares: BagShare[]): {
  key: string;
  tone: 'looking' | 'nothing_yet' | 'couldnt_finish';
  message: string;
}[] {
  const visible = shares.filter((share) => share.state !== 'ready');
  if (visible.length === 0) return [];

  const looking = visible.filter((share) => share.state === 'looking');
  const banners: {
    key: string;
    tone: 'looking' | 'nothing_yet' | 'couldnt_finish';
    message: string;
  }[] = [];

  if (looking.length === 1) {
    const kind = looking[0]?.kind;
    banners.push({
      key: looking[0]!.importId,
      tone: 'looking',
      message:
        kind === 'instagram'
          ? BAG_PROGRESS_COPY.lookingReel
          : kind === 'youtube'
            ? BAG_PROGRESS_COPY.lookingShort
            : BAG_PROGRESS_COPY.looking,
    });
  } else if (looking.length > 1) {
    banners.push({
      key: 'looking-many',
      tone: 'looking',
      message: BAG_PROGRESS_COPY.lookingMany,
    });
  }

  for (const share of visible) {
    if (share.state === 'nothing_yet') {
      banners.push({
        key: share.importId,
        tone: 'nothing_yet',
        message: BAG_PROGRESS_COPY.nothingYet,
      });
    }
    if (share.state === 'couldnt_finish') {
      banners.push({
        key: share.importId,
        tone: 'couldnt_finish',
        message: BAG_PROGRESS_COPY.couldntFinish,
      });
    }
  }
  return banners;
}

export function bagHasInFlightShares(shares: BagShare[]): boolean {
  return shares.some((share) => share.state === 'looking');
}

export function uniqueBagProductIds(items: BagItemView[]): string[] {
  return [...new Set(items.map((item) => item.productId))];
}
