import { validHttpUrl } from './urlValidation';
import {
  classifyShoppingProvider,
  getShoppingProviderPriority,
} from './shoppingPriorityConfig';
import { isExactProductBuyingUrl } from './productUrlIdentity';

export { isExactProductBuyingUrl } from './productUrlIdentity';

/**
 * Business shopping selection config (not pipeline evidence).
 *
 * V1 configuration source: backend/config/shopping.json via ShoppingConfiguration.
 * metadata.shoppingSelection remains an owned extension surface (lower precedence)
 * so future Campaign/Brand systems can populate selection without schema changes.
 *
 * Do not add durable Catalog columns for configured_buying_url in V1.
 */
export type ShoppingSelectionConfig = {
  /** Explicit buying URL — ALWAYS wins over discovery. */
  configuredBuyingUrl?: string | null;
  /**
   * Preferred merchant provider key (e.g. amazon, official, flipkart).
   * Used only when no configured URL exists; requires an exact product URL
   * for that merchant among discovered offers.
   */
  preferredMerchant?: string | null;
};

export type ShoppingSelectionSource =
  | 'configured_url'
  | 'preferred_merchant_exact'
  | 'resolver'
  | 'none';

export function readShoppingSelectionConfig(
  metadata: Record<string, unknown> | null | undefined,
): ShoppingSelectionConfig | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata.shoppingSelection;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  const configuredBuyingUrl =
    typeof cfg.configuredBuyingUrl === 'string' ? cfg.configuredBuyingUrl : null;
  const preferredMerchant =
    typeof cfg.preferredMerchant === 'string' ? cfg.preferredMerchant.trim().toLowerCase() : null;
  if (!configuredBuyingUrl && !preferredMerchant) return null;
  return { configuredBuyingUrl, preferredMerchant };
}

export function mergeShoppingSelectionIntoMetadata(
  metadata: Record<string, unknown> | null | undefined,
  config: ShoppingSelectionConfig | null | undefined,
): Record<string, unknown> {
  const base = { ...(metadata ?? {}) };
  if (!config) return base;
  const next: ShoppingSelectionConfig = {};
  if (config.configuredBuyingUrl != null) {
    next.configuredBuyingUrl = config.configuredBuyingUrl;
  }
  if (config.preferredMerchant != null) {
    next.preferredMerchant = config.preferredMerchant;
  }
  if (!next.configuredBuyingUrl && !next.preferredMerchant) return base;
  base.shoppingSelection = {
    ...((base.shoppingSelection as object) ?? {}),
    ...next,
  };
  return base;
}

/**
 * Precedence:
 * configured URL > preferred-merchant exact product URL > caller-provided resolver winner > none
 */
export function applyShoppingSelectionPrecedence(input: {
  config?: ShoppingSelectionConfig | null;
  discoveredOffers: Array<{ url: string; sourceType?: string | null }>;
  resolverWinnerUrl?: string | null;
  priority?: string[];
}): {
  preferredShoppingUrl: string | null;
  source: ShoppingSelectionSource;
  shoppingProvider: string | null;
} {
  const configured = validHttpUrl(input.config?.configuredBuyingUrl ?? null);
  if (configured) {
    return {
      preferredShoppingUrl: configured,
      source: 'configured_url',
      shoppingProvider: classifyShoppingProvider(configured),
    };
  }

  const preferredMerchant = input.config?.preferredMerchant?.trim().toLowerCase() ?? null;
  if (preferredMerchant) {
    const priority = input.priority ?? getShoppingProviderPriority();
    for (const offer of input.discoveredOffers) {
      const url = validHttpUrl(offer.url);
      if (!url || !isExactProductBuyingUrl(url)) continue;
      const provider = classifyShoppingProvider(url, offer.sourceType as never);
      if (provider === preferredMerchant || (preferredMerchant === 'amazon' && provider === 'amazon')) {
        // Ensure preferred merchant is known in priority list (informational).
        void priority;
        return {
          preferredShoppingUrl: url,
          source: 'preferred_merchant_exact',
          shoppingProvider: provider,
        };
      }
    }
  }

  const resolver = validHttpUrl(input.resolverWinnerUrl ?? null);
  if (resolver) {
    return {
      preferredShoppingUrl: resolver,
      source: 'resolver',
      shoppingProvider: classifyShoppingProvider(resolver),
    };
  }

  return { preferredShoppingUrl: null, source: 'none', shoppingProvider: null };
}
