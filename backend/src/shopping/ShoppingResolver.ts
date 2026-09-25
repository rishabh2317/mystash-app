import type { CatalogProduct } from '../product-intelligence/domain/types';
import { merchantUrlsMatch } from '../product-intelligence/search/directUrlIdentity';
import { logger } from '../logger';
import { resolveMerchantRegion } from '../merchant-pricing/MerchantRegionResolver';
import { AffiliateService } from './AffiliateService';
import { classifyShoppingProvider } from './shoppingPriorityConfig';
import { resolveShoppingSelectionForProduct } from './ShoppingConfiguration';
import {
  catalogShoppingSource,
  findStoredShoppingDestination,
  listStoredShoppingDestinations,
} from './storedDestinations';
import { validHttpUrl } from './urlValidation';

export type ShoppingResolveOptions = {
  offerId?: string | null;
  country?: string | null;
};

export type ShoppingDestinationType = 'configured' | 'affiliate' | 'preferred' | 'merchant';

export type ShoppingResolution = {
  url: string;
  destinationType: ShoppingDestinationType;
  shoppingProvider: string;
  affiliateProvider: string | null;
  merchantName?: string | null;
};

/**
 * The single backend authority for outbound shopping destinations.
 * Controllers and clients must not duplicate this selection order.
 *
 * Precedence:
 * configured buying URL (ShoppingConfiguration / file overrides) >
 * affiliate (when enabled) >
 * preferredShoppingUrl (may already reflect preferred-merchant exact / resolver) >
 * merchantUrl >
 * none
 */
export class ShoppingResolver {
  constructor(private readonly affiliateService: AffiliateService) {}

  resolve(product: CatalogProduct, options?: ShoppingResolveOptions): ShoppingResolution | null {
    const offerId = options?.offerId?.trim();
    const country = options?.country?.trim() || null;
    if (offerId) {
      const dest = findStoredShoppingDestination(catalogShoppingSource(product), offerId);
      if (!dest) {
        logger.warn({ productId: product.id, offerId }, 'shopping.url.offer_unknown');
        return null;
      }
      const url = this.regionalUrl(dest.url, dest.regionalUrls, country);
      const fallback = this.resolveDefault(product, country);
      if (fallback && merchantUrlsMatch(fallback.url, dest.url) && url === dest.url) {
        return { ...fallback, merchantName: dest.merchant };
      }
      return this.selected(product, {
        url,
        destinationType: dest.destinationType,
        shoppingProvider: dest.shoppingProvider,
        affiliateProvider: null,
        merchantName: dest.merchant,
      });
    }
    return this.resolveDefault(product, country);
  }

  private resolveDefault(product: CatalogProduct, country?: string | null): ShoppingResolution | null {
    const source = catalogShoppingSource(product);
    const destinations = listStoredShoppingDestinations(source);

    const resolved = resolveShoppingSelectionForProduct(product.id, product.metadata);
    const configured = validHttpUrl(resolved.selection.configuredBuyingUrl ?? null);
    if (configured) {
      const match = destinations.find((d) => merchantUrlsMatch(d.url, configured));
      return this.selected(product, {
        url: this.regionalUrl(configured, match?.regionalUrls ?? null, country),
        destinationType: 'configured',
        shoppingProvider: product.shoppingProvider ?? classifyShoppingProvider(configured),
        affiliateProvider: null,
        merchantName: match?.merchant ?? product.merchant,
      });
    }

    const affiliate = this.affiliateService.resolveShoppingUrl(product);
    if (affiliate) {
      return this.selected(product, {
        url: affiliate.url,
        destinationType: 'affiliate',
        shoppingProvider: product.shoppingProvider ?? 'affiliate',
        affiliateProvider: affiliate.provider,
        merchantName: product.merchant,
      });
    }

    const preferred = validHttpUrl(product.preferredShoppingUrl);
    if (preferred) {
      const match = destinations.find((d) => merchantUrlsMatch(d.url, preferred));
      return this.selected(product, {
        url: this.regionalUrl(preferred, match?.regionalUrls ?? null, country),
        destinationType: 'preferred',
        shoppingProvider: product.shoppingProvider ?? 'merchant',
        affiliateProvider: null,
        merchantName: match?.merchant ?? product.merchant,
      });
    }

    const merchant = validHttpUrl(product.merchantUrl);
    if (merchant) {
      const match = destinations.find((d) => merchantUrlsMatch(d.url, merchant));
      return this.selected(product, {
        url: this.regionalUrl(merchant, match?.regionalUrls ?? null, country),
        destinationType: 'merchant',
        shoppingProvider: product.shoppingProvider ?? product.merchant ?? 'merchant',
        affiliateProvider: null,
        merchantName: match?.merchant ?? product.merchant,
      });
    }

    logger.warn({ productId: product.id }, 'shopping.url.unavailable');
    return null;
  }

  private regionalUrl(
    url: string,
    regionalUrls: Record<string, string> | null | undefined,
    country: string | null | undefined,
  ): string {
    if (!country) return url;
    return resolveMerchantRegion({ url, regionalUrls }, country).url;
  }

  private selected(product: CatalogProduct, resolution: ShoppingResolution): ShoppingResolution {
    logger.info(
      {
        productId: product.id,
        destinationType: resolution.destinationType,
        shoppingProvider: resolution.shoppingProvider,
        affiliateProvider: resolution.affiliateProvider,
      },
      'shopping.url.selected',
    );
    return resolution;
  }
}
