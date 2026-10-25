import type { ShoppingConfiguration } from '../shopping/ShoppingConfiguration';
import { validHttpUrl } from '../shopping/urlValidation';

/**
 * Campaign buy URL becomes the configured buying URL for that catalog id.
 * File configuration stays the base. Other products are unchanged.
 */
export function withCampaignBuyingUrl(
  base: ShoppingConfiguration,
  catalogProductId: string,
  buyUrl: string | null | undefined,
): ShoppingConfiguration {
  const url = validHttpUrl(buyUrl);
  if (!url || !catalogProductId.trim()) return base;
  const previous = base.productOverrides[catalogProductId];
  return {
    ...base,
    productOverrides: {
      ...base.productOverrides,
      [catalogProductId]: {
        configuredBuyingUrl: url,
        preferredMerchant: previous?.preferredMerchant ?? null,
      },
    },
  };
}
