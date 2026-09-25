import { userFacingAvailability } from '../shopping/storedDestinations';
import type { MerchantPricingAdapter, MerchantPricingAdapterContext } from './adapters/types';
import { LivePriceCache } from './cache';
import type { MerchantPricingConfig } from './config';
import { resolveMerchantRegion } from './MerchantRegionResolver';
import { recordPricingMetric } from './metrics';
import type {
  LivePriceResult,
  LivePricesResponse,
  MerchantPricingOfferInput,
  MerchantPriceFetchResult,
} from './types';

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function fallbackResult(
  offer: MerchantPricingOfferInput,
  merchantUrl: string,
  status: LivePriceResult['status'],
): LivePriceResult {
  return {
    offerId: offer.offerId,
    merchantName: offer.merchant,
    merchantUrl,
    price: offer.price,
    currency: offer.currency,
    availability: userFacingAvailability(offer.availability) ?? offer.availability,
    fetchedAt: null,
    source: 'fallback',
    status,
  };
}

function liveSuccess(
  offer: MerchantPricingOfferInput,
  merchantUrl: string,
  fetched: MerchantPriceFetchResult,
): LivePriceResult {
  return {
    offerId: offer.offerId,
    merchantName: offer.merchant,
    merchantUrl,
    price: fetched.price,
    currency: fetched.currency,
    availability:
      userFacingAvailability(fetched.availability) ??
      fetched.availability ??
      userFacingAvailability(offer.availability) ??
      offer.availability,
    fetchedAt: fetched.fetchedAt,
    source: 'live',
    status: 'success',
  };
}

export class MerchantPricingService {
  constructor(
    private readonly config: MerchantPricingConfig,
    private readonly adapters: MerchantPricingAdapter[],
    private readonly cache: LivePriceCache,
    private readonly fetchHtml?: MerchantPricingAdapterContext['fetchHtml'],
  ) {}

  async getLivePrices(input: {
    productId: string;
    country: string;
    offers: MerchantPricingOfferInput[];
  }): Promise<LivePricesResponse> {
    const fetchedAt = new Date().toISOString();
    const capped = input.offers.slice(0, this.config.maxOffersPerPage);
    const results = await mapPool(capped, this.config.maxConcurrency, (offer) =>
      this.refreshOffer(input.productId, input.country, offer),
    );

    // Preserve remaining offers beyond the cap as fallback-only (still present).
    for (const offer of input.offers.slice(this.config.maxOffersPerPage)) {
      const regional = resolveMerchantRegion(offer, input.country);
      results.push(fallbackResult(offer, regional.url, 'unavailable'));
    }

    return {
      productId: input.productId,
      country: input.country,
      fetchedAt,
      results,
    };
  }

  private async refreshOffer(
    productId: string,
    country: string,
    offer: MerchantPricingOfferInput,
  ): Promise<LivePriceResult> {
    const regional = resolveMerchantRegion(offer, country);
    const cacheKey = LivePriceCache.key({
      productId,
      offerId: offer.offerId,
      url: regional.url,
      country: regional.countryCode,
    });

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const inflight = this.cache.getInflight(cacheKey);
    if (inflight) return inflight;

    const promise = this.fetchOffer(offer, regional.url, regional.countryCode).then((result) => {
      // Cache successful live results and terminal failures for stampede control.
      this.cache.set(cacheKey, result);
      return result;
    });
    this.cache.setInflight(cacheKey, promise);
    return promise;
  }

  private async fetchOffer(
    offer: MerchantPricingOfferInput,
    merchantUrl: string,
    country: string,
  ): Promise<LivePriceResult> {
    const ctx: MerchantPricingAdapterContext = {
      url: merchantUrl,
      timeoutMs: this.config.perMerchantTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      maxRedirects: this.config.maxRedirects,
      fetchHtml: this.fetchHtml,
    };

    let lastStatus: LivePriceResult['status'] = 'invalid';
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.tryExtract(ctx);
        if (!result) continue;
        if (result.status === 'success' && result.price) {
          recordPricingMetric({
            status: 'success',
            adapter: adapter.name,
            merchant: offer.merchant,
            country,
          });
          return liveSuccess(offer, merchantUrl, result);
        }
        lastStatus = result.status;
        if (result.status === 'timeout' || result.status === 'blocked') {
          recordPricingMetric({
            status: result.status,
            adapter: adapter.name,
            merchant: offer.merchant,
            country,
          });
          return fallbackResult(offer, merchantUrl, result.status);
        }
      } catch {
        lastStatus = 'invalid';
      }
    }

    recordPricingMetric({
      status: lastStatus,
      adapter: null,
      merchant: offer.merchant,
      country,
    });
    return fallbackResult(offer, merchantUrl, lastStatus);
  }
}
