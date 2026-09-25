import type { ImportShare } from '@/src/services/importShareMap';
import type { CartItemSource, CartLine } from '@/src/services/cartLineMap';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import { formatProductPrice } from '@/src/ui/collectionSections';

/** One Stash row. Canonical and discovered products share this shape. */
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

export type StashSectionPresentation = 'rail' | 'grid';

export type StashSection = {
  key: string;
  title: string;
  items: BagItemView[];
  presentation: StashSectionPresentation;
};

/** Category shelf tile on Stash home. */
export type StashCategoryCardModel = {
  key: string;
  title: string;
  count: number;
  previewUrls: (string | null)[];
  items: BagItemView[];
};

export type StashHomeLayout = {
  countLabel: string;
  categories: StashCategoryCardModel[];
  recent: BagItemView[];
};

/** @deprecated Prefer StashHomeLayout — kept for older tests during transition. */
export type StashLayout = {
  countLabel: string;
  summaryLine: string | null;
  sections: StashSection[];
};

export type BagShareState = ImportShare['state'];

export type BagShare = Pick<ImportShare, 'importId' | 'state' | 'kind'>;

export const BAG_PROGRESS_COPY = {
  looking: 'Finding products from your link…',
  lookingReel: 'Finding products from your Reel…',
  lookingShort: 'Finding products from your Short…',
  lookingMany: 'Finding products from your links…',
  nothingYet: "We couldn't find products in that link yet.",
  couldntFinish: "We couldn't finish that link. Try sharing it again.",
  emptyHint: "See something you love? Stash it here and we'll remember it for you.",
} as const;

export const OTHER_BAG_CATEGORY = 'Other';

const RECENT_STASH_LIMIT = 8;

function bagCategoryKey(category: string | null | undefined): string {
  const raw = category?.trim();
  if (!raw || /^unknown$/i.test(raw) || /^n\/?a$/i.test(raw)) return OTHER_BAG_CATEGORY;
  return raw;
}

/** Quiet source chip for Stash cards (not a full sentence). */
export function stashSourceWhisper(source: CartItemSource | null | undefined): string | null {
  switch (source?.surface) {
    case 'USER_IMPORT':
      return 'Shared';
    case 'COLLECTION':
      return 'Collection';
    case 'SEARCH':
      return 'Search';
    case 'PRODUCT_DETAILS':
      return 'Product';
    default:
      return null;
  }
}

/** Legacy sentence labels — prefer `stashContextLabel` on Stash UI. */
export function bagSourceLabel(source: CartItemSource | null | undefined): string | null {
  return stashSourceWhisper(source);
}

export function bagAvailabilityLabel(
  availability: CartLine['availability'],
): string | null {
  if (availability === 'NO_DESTINATION') return 'Shopping link unavailable';
  if (availability === 'UNAVAILABLE') return 'Unavailable';
  return null;
}

/** Relative time from addedAt for quiet memory context. */
export function stashRelativeTime(
  addedAt: string,
  nowMs: number = Date.now(),
): string | null {
  const ms = Date.parse(addedAt);
  if (!Number.isFinite(ms)) return null;
  const deltaSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (deltaSec < 60) return 'just now';
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** e.g. "Shared · 2h ago" — why this is in the Stash. */
export function stashContextLabel(
  item: Pick<BagItemView, 'source' | 'addedAt'>,
  nowMs: number = Date.now(),
): string | null {
  const parts = [stashSourceWhisper(item.source), stashRelativeTime(item.addedAt, nowMs)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(' · ') : null;
}

export function formatStashCategoryTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return OTHER_BAG_CATEGORY;
  if (trimmed === OTHER_BAG_CATEGORY) return OTHER_BAG_CATEGORY;
  return trimmed
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function bagItemFromLine(line: CartLine): BagItemView {
  const product = line.product ?? {
    id: line.productId,
    catalogProductId: line.catalogProductId,
    title: 'Stashed item',
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
  const category = bagCategoryKey(product.category);
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
    const key = bagCategoryKey(item.category);
    const list = buckets.get(key) ?? [];
    list.push({ ...item, category: key === OTHER_BAG_CATEGORY ? null : key });
    buckets.set(key, list);
  }
  const named = [...buckets.entries()].filter(([key]) => key !== OTHER_BAG_CATEGORY);
  named.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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

/**
 * Stash home shelves from existing fields only:
 * - Category cards → category (only groups with products)
 * - Recently stashed → addedAt
 * Ready-to-shop is intentionally omitted (no cart theatre).
 */
export function buildStashHome(items: BagItemView[]): StashHomeLayout {
  const sorted = sortBagItems(items);
  const total = sorted.length;
  const countLabel = total === 1 ? '1 stashed' : `${total} stashed`;

  const categories: StashCategoryCardModel[] = groupBagItems(items)
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const title =
        group.key === OTHER_BAG_CATEGORY || !group.title
          ? OTHER_BAG_CATEGORY
          : formatStashCategoryTitle(group.title);
      return {
        key: group.key,
        title,
        count: group.items.length,
        previewUrls: group.items.slice(0, 4).map((item) => item.imageUrl),
        items: group.items,
      };
    });

  return {
    countLabel,
    categories,
    recent: sorted.slice(0, Math.min(RECENT_STASH_LIMIT, total)),
  };
}

/** @deprecated Use buildStashHome. */
export function buildStashLayout(items: BagItemView[]): StashLayout {
  const home = buildStashHome(items);
  const sections: StashSection[] = [];
  if (home.recent.length) {
    sections.push({
      key: 'recent',
      title: 'Recently stashed',
      items: home.recent,
      presentation: home.recent.length <= 2 ? 'grid' : 'rail',
    });
  }
  for (const category of home.categories) {
    sections.push({
      key: `cat-${category.key}`,
      title: `${category.title} · ${category.count}`,
      items: category.items,
      presentation: 'grid',
    });
  }
  return {
    countLabel: home.countLabel,
    summaryLine: home.recent.length
      ? home.recent.length === 1
        ? '1 find'
        : `${home.recent.length} finds`
      : null,
    sections,
  };
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
