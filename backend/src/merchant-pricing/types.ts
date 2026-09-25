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

export type ExtractedMerchantPrice = {
  price: string;
  currency: string | null;
  availability: string | null;
};

export type MerchantPriceFetchStatus =
  | 'success'
  | 'unavailable'
  | 'timeout'
  | 'blocked'
  | 'invalid';

export type MerchantPriceFetchResult = {
  status: MerchantPriceFetchStatus;
  price: string | null;
  currency: string | null;
  availability: string | null;
  fetchedAt: string;
};

export type MerchantPricingOfferInput = {
  offerId: string;
  url: string;
  merchant: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
  regionalUrls?: Record<string, string> | null;
};

export type LivePricesResponse = {
  productId: string;
  country: string;
  fetchedAt: string;
  results: LivePriceResult[];
};
