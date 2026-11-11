import {resolveShoppingRequestCountry} from '../shopping/requestCountry';
import type { Express, Request, Response } from 'express';
import { isValidCatalogProductId } from '../cart/domain/lifecycle';
import { createCatalogService } from '../catalog/factory';
import { createDiscoveredProductService } from '../discovered/factory';
import { logger } from '../logger';
import {
  catalogShoppingSource,
  discoveredShoppingSource,
  listStoredShoppingDestinations,
} from '../shopping/storedDestinations';
import { createSupabaseAdmin } from '../supabase';
import { createMerchantPricingService } from './factory';
import type { MerchantPricingOfferInput } from './types';

export function registerMerchantPricingRoutes(app: Express): void {
  const admin = createSupabaseAdmin();
  const catalog = createCatalogService(admin);
  const discovered = createDiscoveredProductService(admin);
  const pricing = createMerchantPricingService();

  app.get('/products/:id/live-prices', async (req: Request, res: Response) => {
    try {
      const productId = String(req.params.id ?? '').trim();
      if (!isValidCatalogProductId(productId)) {
        res.status(400).json({ error: 'Product id is required' });
        return;
      }

      const country = await resolveShoppingRequestCountry(admin,req);

      const catalogProduct = await catalog.resolveActiveProduct(productId);
      let offers: MerchantPricingOfferInput[] = [];

      if (catalogProduct && catalogProduct.status !== 'HIDDEN') {
        offers = listStoredShoppingDestinations(catalogShoppingSource(catalogProduct),country).map((d) => ({
          offerId: d.offerId,
          url: d.url,
          merchant: d.merchant,
          price: d.price,
          currency: d.currency,
          availability: d.availability,
          regionalUrls: d.regionalUrls,
        }));
      } else {
        const imported = await discovered.getById(productId);
        if (!imported || imported.internalStatus !== 'ACTIVE') {
          res.status(404).json({ error: 'Product not found' });
          return;
        }
        offers = listStoredShoppingDestinations(discoveredShoppingSource(imported),country).map((d) => ({
          offerId: d.offerId,
          url: d.url,
          merchant: d.merchant,
          price: d.price,
          currency: d.currency,
          availability: d.availability,
          regionalUrls: d.regionalUrls,
        }));
      }

      const payload = await pricing.getLivePrices({ productId, country, offers });
      res.json(payload);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Could not refresh live prices' });
    }
  });
}
