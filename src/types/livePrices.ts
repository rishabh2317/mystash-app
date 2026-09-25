export type LivePriceSource = 'live' | 'fallback';

export type LivePriceStatus =
  | 'success'
  | 'unavailable'
  | 'timeout'
  | 'blocked'
  | 'invalid';

export type LivePriceResult = {
  offerId: string;
  merchantName: string | null;
  merchantUrl: string;
  price: string | null;
  currency: string | null;
  availability: string | null;
  fetchedAt: string | null;
  source: LivePriceSource;
  status: LivePriceStatus;
};

export type LivePricesResponse = {
  productId: string;
  country: string;
  fetchedAt: string;
  results: LivePriceResult[];
};

/** Client display state for a merchant offer after optional live refresh. */
export type OfferPriceFreshness = 'loading' | 'live' | 'stale' | 'stored';
