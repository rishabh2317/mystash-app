import type { ExtractedMerchantPrice } from '../types';
import { successResult, type MerchantPricingAdapter, type MerchantPricingAdapterContext } from './types';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Merchant-specific deterministic hooks (no LLM).
 * Host extractors only run when HTML is already available via fetchHtml (tests)
 * or after the structured adapter supplies HTML through the shared pipeline.
 */
export function createMerchantSpecificAdapter(
  extractors: Record<string, (html: string) => ExtractedMerchantPrice | null> = {},
): MerchantPricingAdapter {
  return {
    name: 'merchant-specific',
    async tryExtract(ctx: MerchantPricingAdapterContext) {
      const host = hostOf(ctx.url);
      if (!host) return null;
      const extractor =
        extractors[host] ??
        Object.entries(extractors).find(([suffix]) => host === suffix || host.endsWith(`.${suffix}`))?.[1];
      if (!extractor || !ctx.fetchHtml) return null;
      const loaded = await ctx.fetchHtml(ctx.url);
      if (loaded.blocked) {
        return {
          status: 'blocked',
          price: null,
          currency: null,
          availability: null,
          fetchedAt: new Date().toISOString(),
        };
      }
      if (!loaded.body) return null;
      const extracted = extractor(loaded.body);
      return extracted ? successResult(extracted) : null;
    },
  };
}
