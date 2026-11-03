/**
 * Share Activity view models — user-facing mapping for Search Activity + Your Shares.
 * Never expose queue/resolver/enrichment vocabulary.
 */

import type { ImportShare, ImportShareState } from '@/src/services/importShareMap';
import { productPagePath } from '@/src/ui/productPage';

export type ShareActivityUserState = 'processing' | 'products_found' | 'places_found' | 'both_found' | 'partial' | 'results_ready' | 'no_products' | 'failed';

export type ShareActivityView = {
  importId: string;
  kind: ImportShare['kind'];
  userState: ShareActivityUserState;
  createdAt: string;
  productCount: number;
  placeCount?: number;
  hasInFlight?: boolean;
  canRetry?: boolean;
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
  processing: 'Finding products and places…',
  processingReel: 'Finding products and places from your Reel…',
  processingShort: 'Finding products and places from your Short…',
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
  empty: 'No activity yet',
  emptyHint: 'Open Find to capture a product, Reel, or Short link.',
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

function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function resultSubtitle(share: ImportShare): string {
  const products = share.resultProductCount ?? share.productCount;
  const places = share.placeCount ?? 0;
  const found = [products ? countLabel(products, 'product') : '', places ? countLabel(places, 'place') : '']
    .filter(Boolean).join(' · ');
  const running = [share.productStatus === 'running' ? 'products' : '', share.placeStatus === 'running' ? 'places' : '']
    .filter(Boolean).join(' and ');
  const failures = [share.productStatus === 'failed' ? 'Products couldn’t finish' : '',
    share.placeStatus === 'failed' ? (places ? 'Place verification couldn’t finish' : 'Places couldn’t finish') : '']
    .filter(Boolean).join(' · ');
  if (share.findOutcome.delayed) return [found ? `${found} found` : '', 'Taking longer than expected'].filter(Boolean).join(' · ');
  if (share.findOutcome.stashSync === 'failed') return [found ? `${found} found` : '', 'Saving needs another try'].filter(Boolean).join(' · ');
  if (share.hasInFlight && !running) return [found ? `${found} found` : '', 'Finishing discovery…'].filter(Boolean).join(' · ');
  if (running) return [found ? `${found} found` : '', `Finding ${running}…`, failures].filter(Boolean).join(' · ');
  if (failures) return [found ? `${found} found` : '', failures].filter(Boolean).join(' · ');
  if (found) return `${found} found`;
  if (share.productStatus === 'complete' && share.placeStatus === 'complete') {
    return share.kind === 'web' ? 'No products found' : 'No products or places found';
  }
  return 'Results ready';
}

function resultUserState(share: ImportShare): ShareActivityUserState {
  const products = share.resultProductCount ?? share.productCount;
  const places = share.placeCount ?? 0;
  if (share.hasInFlight) return products || places ? 'partial' : 'processing';
  if (share.canRetry) return products || places ? 'partial' : 'failed';
  if (products && places) return 'both_found';
  if (places) return 'places_found';
  if (products) return 'products_found';
  return share.productStatus === 'complete' && share.placeStatus === 'complete' ? 'no_products' : 'results_ready';
}

export function mapImportShareToActivity(share: ImportShare): ShareActivityView {
  const userState = resultUserState(share);
  const platformLabel = sharePlatformLabel(share.kind);
  return {
    importId: share.importId,
    kind: share.kind,
    userState,
    createdAt: share.createdAt,
    productCount: share.resultProductCount ?? share.productCount,
    placeCount: share.placeCount ?? 0,
    hasInFlight: share.hasInFlight ?? share.state === 'looking',
    canRetry: share.canRetry ?? share.state === 'couldnt_finish',
    contentSourceId: share.contentSourceId,
    sourceUrl: share.sourceUrl,
    title: platformLabel,
    subtitle: resultSubtitle(share),
    imageUrl: share.primaryProduct?.imageUrl ?? share.products[0]?.imageUrl ?? null,
    platformLabel,
    products: share.resultProducts ?? share.products,
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
  const looking = sorted.filter((s) => s.hasInFlight ?? s.state === 'looking');
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
  | { kind: 'places'; path: '/stash?segment=places' }
  | { kind: 'none' };

/**
 * Strict nav: exactly 1 product → Product Page; 2+ → Bag.
 * Never open primary product for multi-product shares.
 */
export function shareActivityDestination(
  share: Pick<
    ImportShare,
    'state' | 'productCount' | 'primaryProduct' | 'contentSourceId' | 'importId'
  > & Partial<Pick<ImportShare, 'placeCount' | 'resultProductCount'>>,
): ShareActivityDestination {
  if ((share.placeCount ?? 0) > 0 && (share.resultProductCount ?? share.productCount) === 0) {
    return { kind: 'places', path: '/stash?segment=places' };
  }
  if (share.state === 'looking') return { kind: 'bag', path: '/cart' };
  if (share.productCount === 0 && share.state !== 'ready') return { kind: 'none' };

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
    case 'places_found': return 'Places found';
    case 'both_found': return 'Products and places found';
    case 'partial': return 'Partial results';
    case 'results_ready': return 'Results ready';
    case 'no_products':
      return 'No results';
    case 'failed':
      return 'Failed';
  }
}
