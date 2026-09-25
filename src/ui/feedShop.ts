import type { ProductPageOffer } from '@/src/types/productPage';

/** Home feed product zone copy — keep CTA language stable. */
export const FEED_SHOP_COPY = {
  shopThisPost: 'Shop this post',
  shopThisPostA11y: 'Shop this post, open collection',
  sheetTitle: 'Buy options',
  closeA11y: 'Close',
  loadingMerchants: 'Loading buy options…',
  noMerchants: 'No shopping destinations are available for this product yet.',
  openError: 'Could not open the product link.',
} as const;

/** Offers that can open a merchant destination (excludes action `none`). */
export function shoppableProductOffers(
  offers: ReadonlyArray<ProductPageOffer>,
): ProductPageOffer[] {
  return offers.filter((offer) => offer.action === 'buy' || offer.action === 'listing');
}

/**
 * Single shoppable offer → open directly (no sheet).
 * Multiple → show sheet. Zero → still attempt catalog redirect without offerId.
 */
export type FeedShopPresentation = 'direct' | 'sheet' | 'fallback';

export function feedShopPresentation(shoppableCount: number): FeedShopPresentation {
  if (shoppableCount === 1) return 'direct';
  if (shoppableCount > 1) return 'sheet';
  return 'fallback';
}
