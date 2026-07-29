import type { CatalogProduct } from '../product-intelligence/domain/types';
import { logger } from '../logger';
import type { AffiliateConfig } from './affiliateConfig';
import { validHttpUrl } from './urlValidation';

export type AffiliateResolution = {
  url: string;
  provider: string;
};

/**
 * Boundary for future affiliate network integrations.
 * V1 never constructs an affiliate URL: disabled is the safe default, and a
 * configured provider must supply a fully resolved URL through the catalog.
 */
export class AffiliateService {
  constructor(private readonly config: AffiliateConfig) {}

  resolveShoppingUrl(product: CatalogProduct): AffiliateResolution | null {
    if (!this.config.enabled) {
      logger.debug({ productId: product.id }, 'affiliate.disabled');
      return null;
    }

    logger.info(
      { productId: product.id, affiliateProvider: this.config.provider },
      'affiliate.enabled',
    );
    if (this.config.provider === 'none') {
      logger.warn({ productId: product.id }, 'affiliate.provider.not_configured');
      return null;
    }

    const url = validHttpUrl(product.affiliateUrl);
    if (!url) {
      if (product.affiliateUrl) {
        logger.warn(
          { productId: product.id, affiliateProvider: this.config.provider },
          'affiliate.url.invalid',
        );
      }
      return null;
    }

    logger.info(
      { productId: product.id, affiliateProvider: this.config.provider },
      'affiliate.provider.selected',
    );
    return { url, provider: this.config.provider };
  }
}
