import type { MerchantPriceFetchResult } from '../types';
import type { MerchantPricingAdapter, MerchantPricingAdapterContext } from './types';

export type BrowserPriceFetcher = (
  url: string,
  opts: { timeoutMs: number },
) => Promise<MerchantPriceFetchResult | null>;

/**
 * Pluggable browser-rendered fallback for JS-heavy merchants.
 * Disabled by default; keep out of the primary path.
 * Compatible with local Playwright/Puppeteer wiring and future production workers.
 */
export function createBrowserFallbackAdapter(options: {
  enabled: boolean;
  fetchPrice?: BrowserPriceFetcher;
}): MerchantPricingAdapter {
  return {
    name: 'browser-fallback',
    async tryExtract(ctx: MerchantPricingAdapterContext) {
      if (!options.enabled || !options.fetchPrice) return null;
      try {
        return await options.fetchPrice(ctx.url, { timeoutMs: ctx.timeoutMs });
      } catch {
        return {
          status: 'invalid',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }
    },
  };
}
