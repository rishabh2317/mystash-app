import {
  isUnavailableAvailability,
  userFacingAvailability,
  type StoredShoppingDestination,
} from '../../shopping/storedDestinations';
import type { ProductPageOffer, ProductPageOfferAction } from './types';

export function projectPageOffers(
  destinations: StoredShoppingDestination[],
  action: Exclude<ProductPageOfferAction, 'none'>,
): ProductPageOffer[] {
  const offers: ProductPageOffer[] = [];
  for (const dest of destinations) {
    const unavailable = isUnavailableAvailability(dest.availability);
    // Missing price must not drop a valid merchant destination.
    offers.push({
      id: dest.offerId,
      merchant: dest.merchant,
      price: dest.price,
      currency: dest.currency,
      availability: userFacingAvailability(dest.availability),
      action: unavailable ? 'none' : action,
    });
  }
  return offers;
}

export function pageLevelPrice(
  offers: ProductPageOffer[],
  fallback: { price: string | null; currency: string | null },
): { price: string | null; currency: string | null } {
  if (offers.length > 1) return { price: null, currency: null };
  return fallback;
}
