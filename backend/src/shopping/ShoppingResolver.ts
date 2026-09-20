import type { CatalogProduct } from '../product-intelligence/domain/types';
import { merchantUrlsMatch } from '../product-intelligence/search/directUrlIdentity';
import { logger } from '../logger';
import { AffiliateService } from './AffiliateService';
import { classifyShoppingProvider } from './shoppingPriorityConfig';
import { resolveShoppingSelectionForProduct } from './ShoppingConfiguration';
import { catalogShoppingSource, findStoredShoppingDestination } from './storedDestinations';
import { validHttpUrl } from './urlValidation';

export type ShoppingResolveOptions = {
  offerId?: string | null;
};

export type ShoppingDestinationType = 'configured' | 'affiliate' | 'preferred' | 'merchant';

export type ShoppingResolution = {
  url: string;
  destinationType: ShoppingDestinationType;
  shoppingProvider: string;
  affiliateProvider: string | null;
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
    if (offerId) {
      const dest = findStoredShoppingDestination(catalogShoppingSource(product), offerId);
      if (!dest) {
        logger.warn({ productId: product.id, offerId }, 'shopping.url.offer_unknown');
        return null;
      }
      const fallback = this.resolveDefault(product);
      if (fallback && merchantUrlsMatch(fallback.url, dest.url)) {
        return fallback;
      }
      return this.selected(product, {
        url: dest.url,
        destinationType: dest.destinationType,
        shoppingProvider: dest.shoppingProvider,
        affiliateProvider: null,
      });
    }
    return this.resolveDefault(product);
  }

  private resolveDefault(product: CatalogProduct): ShoppingResolution | null {
    const resolved = resolveShoppingSelectionForProduct(product.id, product.metadata);
    const configured = validHttpUrl(resolved.selection.configuredBuyingUrl ?? null);
    if (configured) {
      return this.selected(product, {
        url: configured,
        destinationType: 'configured',
        shoppingProvider:
          product.shoppingProvider ?? classifyShoppingProvider(configured),
        affiliateProvider: null,
      });
    }

    const affiliate = this.affiliateService.resolveShoppingUrl(product);
    if (affiliate) {
      return this.selected(product, {
        url: affiliate.url,
        destinationType: 'affiliate',
        shoppingProvider: product.shoppingProvider ?? 'affiliate',
        affiliateProvider: affiliate.provider,
      });
    }

    const preferred = validHttpUrl(product.preferredShoppingUrl);
    if (preferred) {
      return this.selected(product, {
        url: preferred,
        destinationType: 'preferred',
        shoppingProvider: product.shoppingProvider ?? 'merchant',
        affiliateProvider: null,
      });
    }

    const merchant = validHttpUrl(product.merchantUrl);
    if (merchant) {
      return this.selected(product, {
        url: merchant,
        destinationType: 'merchant',
        shoppingProvider: product.shoppingProvider ?? product.merchant ?? 'merchant',
        affiliateProvider: null,
      });
    }

    logger.warn({ productId: product.id }, 'shopping.url.unavailable');
    return null;
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
