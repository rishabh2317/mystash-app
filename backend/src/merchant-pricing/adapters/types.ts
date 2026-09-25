import type { ExtractedMerchantPrice, MerchantPriceFetchResult } from '../types';

export type MerchantPricingAdapterContext = {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** Optional fetch override for tests. */
  fetchHtml?: (url: string) => Promise<{ status: number; body: string; blocked?: boolean }>;
};

export type MerchantPricingAdapter = {
  readonly name: string;
  /** Return null to defer to the next adapter. */
  tryExtract(ctx: MerchantPricingAdapterContext): Promise<MerchantPriceFetchResult | null>;
};

export function successResult(
  extracted: ExtractedMerchantPrice,
  fetchedAt = new Date().toISOString(),
): MerchantPriceFetchResult {
  return {
    status: 'success',
    price: extracted.price,
    currency: extracted.currency,
    availability: extracted.availability,
    fetchedAt,
  };
}
