import { createHttpStructuredAdapter } from './adapters/HttpStructuredAdapter';
import { createBrowserFallbackAdapter, type BrowserPriceFetcher } from './adapters/browserFallback';
import { createMerchantSpecificAdapter } from './adapters/MerchantSpecificAdapter';
import type { MerchantPricingAdapterContext } from './adapters/types';
import { LivePriceCache } from './cache';
import { getMerchantPricingConfig } from './config';
import { MerchantPricingService } from './MerchantPricingService';

let sharedCache: LivePriceCache | null = null;

function sharedLivePriceCache(): LivePriceCache {
  const cfg = getMerchantPricingConfig();
  if (!sharedCache) {
    sharedCache = new LivePriceCache(cfg.cacheTtlMs);
  }
  return sharedCache;
}

/** Test helper — clear stampede cache. */
export function resetLivePriceCache(): void {
  sharedCache?.clear();
  sharedCache = null;
}

export function createMerchantPricingService(options?: {
  fetchHtml?: MerchantPricingAdapterContext['fetchHtml'];
  browserFetch?: BrowserPriceFetcher;
}): MerchantPricingService {
  const cfg = getMerchantPricingConfig();
  const adapters = [
    createMerchantSpecificAdapter(),
    createHttpStructuredAdapter(),
    createBrowserFallbackAdapter({
      enabled: cfg.browserFallbackEnabled,
      fetchPrice: options?.browserFetch,
    }),
  ];
  return new MerchantPricingService(cfg, adapters, sharedLivePriceCache(), options?.fetchHtml);
}

export { MerchantPricingService } from './MerchantPricingService';
