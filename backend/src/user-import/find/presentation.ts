import type { ShareProgressPrimaryProduct } from '../domain/types';
import type { FindOutcome } from './outcome';

/** Existing screens consume aliases derived ONLY from the authoritative outcome. */
export function findPresentation(findOutcome: FindOutcome, products: ShareProgressPrimaryProduct[]) {
  const found = findOutcome.foundProducts + findOutcome.foundPlaces > 0;
  const hasInFlight = findOutcome.extractionActive || findOutcome.category === 'processing';
  const state = found ? 'ready' as const : hasInFlight ? 'looking' as const
    : findOutcome.result === 'empty' ? 'nothing_yet' as const : 'couldnt_finish' as const;
  return { findOutcome, state, productCount: findOutcome.foundProducts, products, primaryProduct: products[0] ?? null,
    resultVersion: 1 as const, timedOut: findOutcome.delayed,
    resultProductCount: findOutcome.foundProducts, resultProducts: products, placeCount: findOutcome.foundPlaces, resolvedPlaceCount: findOutcome.resolvedPlaces, unverifiedPlaceCount: findOutcome.unverifiedPlaces,
    productStatus: findOutcome.products, placeStatus: findOutcome.places, hasInFlight,
    canRetry: findOutcome.canRetryExtraction || findOutcome.canRetrySaving };
}
