/**
 * Share Activity view models — user-facing mapping for Search Activity + Your Shares.
 * Never expose queue/resolver/enrichment vocabulary.
 */

import type { ImportShare, ImportShareState } from '@/src/services/importShareMap';
import { productPagePath } from '@/src/ui/productPage';

export type ShareActivityUserState = 'processing' | 'products_found' | 'no_products' | 'failed';

export type ShareActivityView = {
  importId: string;
  kind: ImportShare['kind'];
  userState: ShareActivityUserState;
  createdAt: string;
  productCount: number;
  contentSourceId: string | null;
  sourceUrl: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  platformLabel: string;
  products: ImportShare['products'];
};

export const SHARE_ACTIVITY_COPY = {
  sectionTitle: 'Your activity',
  seeAll: 'See all',
  sharesTitle: 'Your Shares',
  processing: 'Finding products…',
  processingReel: 'Finding products from your Reel…',
  processingShort: 'Finding products from your Short…',
  processingLink: 'Finding products from your link…',
  productsFound: 'Products found',
  productsFoundOne: '1 product found',
  productsFoundMany: (n: number) => `${n} products found`,
  noProducts: "We couldn't find products yet",
  failed: "We couldn't finish that link",
  platformReel: 'Instagram Reel',
  platformShort: 'YouTube Short',
  platformLink: 'Shared link',
  viewInBag: 'View in Bag',
  sharedAt: 'Shared',
  sourceLabel: 'Source',
  stateLabel: 'Status',
  retry: 'Retry',
  delete: 'Delete',
} as const;

export function shareActivityUserState(state: ImportShareState): ShareActivityUserState {
  switch (state) {
    case 'looking':
      return 'processing';
    case 'ready':
      return 'products_found';
    case 'nothing_yet':
      return 'no_products';
    case 'couldnt_finish':
      return 'failed';
  }
}

export function sharePlatformLabel(kind: ImportShare['kind']): string {
  if (kind === 'instagram') return SHARE_ACTIVITY_COPY.platformReel;
  if (kind === 'youtube') return SHARE_ACTIVITY_COPY.platformShort;
  return SHARE_ACTIVITY_COPY.platformLink;
}

function processingSubtitle(kind: ImportShare['kind']): string {
  if (kind === 'instagram') return SHARE_ACTIVITY_COPY.processingReel;
  if (kind === 'youtube') return SHARE_ACTIVITY_COPY.processingShort;
  return SHARE_ACTIVITY_COPY.processingLink;
}

function outcomeSubtitle(share: ImportShare, userState: ShareActivityUserState): string {
  if (userState === 'processing') return processingSubtitle(share.kind);
  if (userState === 'no_products') return SHARE_ACTIVITY_COPY.noProducts;
  if (userState === 'failed') return SHARE_ACTIVITY_COPY.failed;
  if (share.productCount === 1) {
    return share.primaryProduct?.title?.trim() || SHARE_ACTIVITY_COPY.productsFoundOne;
  }
  if (share.productCount > 1) {
    const name = share.primaryProduct?.title?.trim();
    if (name) return `${name} · ${SHARE_ACTIVITY_COPY.productsFoundMany(share.productCount)}`;
    return SHARE_ACTIVITY_COPY.productsFoundMany(share.productCount);
  }
  return SHARE_ACTIVITY_COPY.productsFound;
}

export function mapImportShareToActivity(share: ImportShare): ShareActivityView {
  const userState = shareActivityUserState(share.state);
  const platformLabel = sharePlatformLabel(share.kind);
  return {
    importId: share.importId,
    kind: share.kind,
    userState,
    createdAt: share.createdAt,
    productCount: share.productCount,
    contentSourceId: share.contentSourceId,
    sourceUrl: share.sourceUrl,
    title: platformLabel,
    subtitle: outcomeSubtitle(share, userState),
    imageUrl: share.primaryProduct?.imageUrl ?? share.products[0]?.imageUrl ?? null,
    platformLabel,
    products: share.products,
  };
}

function byCreatedAtDesc(a: ImportShare, b: ImportShare): number {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return a.importId < b.importId ? 1 : a.importId > b.importId ? -1 : 0;
}

/**
 * Search landing: only the latest relevant share.
 * Prefer newest looking (active extraction); else newest terminal share.
 * Full history lives on Your Shares.
 */
export function shareActivityLandingItems(shares: ImportShare[]): ShareActivityView[] {
  const sorted = [...shares].sort(byCreatedAtDesc);
  const looking = sorted.filter((s) => s.state === 'looking');
  if (looking.length > 0) {
    return [mapImportShareToActivity(looking[0]!)];
  }
  const latest = sorted.find((s) => s.state !== 'looking');
  return latest ? [mapImportShareToActivity(latest)] : [];
}

export function shareActivityHistoryItems(shares: ImportShare[]): ShareActivityView[] {
  return [...shares].sort(byCreatedAtDesc).map(mapImportShareToActivity);
}

export type ShareActivityDestination =
  | { kind: 'product'; path: string }
  | { kind: 'bag'; path: '/cart' }
  | { kind: 'none' };

/**
 * Strict nav: exactly 1 product → Product Page; 2+ → Bag.
 * Never open primary product for multi-product shares.
 */
export function shareActivityDestination(
  share: Pick<
    ImportShare,
    'state' | 'productCount' | 'primaryProduct' | 'contentSourceId' | 'importId'
  >,
): ShareActivityDestination {
  if (share.state === 'looking') return { kind: 'bag', path: '/cart' };
  if (share.state === 'nothing_yet' || share.state === 'couldnt_finish') return { kind: 'none' };
  if (share.state !== 'ready') return { kind: 'none' };

  if (share.productCount >= 2) return { kind: 'bag', path: '/cart' };
  if (share.productCount === 1 && share.primaryProduct?.productId) {
    return {
      kind: 'product',
      path: productPagePath(share.primaryProduct.productId, {
        contentSourceId: share.contentSourceId,
        userImportId: share.importId,
      }),
    };
  }
  return { kind: 'bag', path: '/cart' };
}

/** Relative time for Activity/Shares rows. */
export function shareActivityRelativeTime(
  createdAt: string,
  nowMs: number = Date.now(),
): string {
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return '';
  const deltaSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (deltaSec < 60) return 'Just now';
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function shareActivityStateLabel(userState: ShareActivityUserState): string {
  switch (userState) {
    case 'processing':
      return 'Processing';
    case 'products_found':
      return SHARE_ACTIVITY_COPY.productsFound;
    case 'no_products':
      return 'No products';
    case 'failed':
      return 'Failed';
  }
}
