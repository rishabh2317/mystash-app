import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { createSupabaseUserClient } from '../supabase';
import { createCatalogService } from '../catalog/factory';
import { createDiscoveredProductService } from '../discovered/factory';
import { createEngagementService } from '../engagement/factory';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import { resolveCountryCode } from '../merchant-pricing/country';
import { resolveMerchantRegion } from '../merchant-pricing/MerchantRegionResolver';
import { AffiliateService } from './AffiliateService';
import { getAffiliateConfig } from './affiliateConfig';
import { ShoppingResolver, type ShoppingResolution } from './ShoppingResolver';
import {
  discoveredShoppingSource,
  findStoredShoppingDestination,
  listStoredShoppingDestinations,
} from './storedDestinations';
import { validHttpUrl } from './urlValidation';

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function headerString(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function wantsJson(req: Request): boolean {
  const format = queryString(req.query.format)?.toLowerCase();
  if (format === 'json') return true;
  const accept = headerString(req.headers.accept) ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

async function authenticatedUserId(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    const {
      data: { user },
    } = await createSupabaseUserClient(auth).auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function resolveRequestCountry(req: Request): string {
  return resolveCountryCode({
    explicit: queryString(req.query.country),
    profile: queryString(req.query.profileCountry),
    deviceLocale: queryString(req.query.locale) ?? headerString(req.headers['accept-language']),
  });
}

async function redirectCatalog(
  req: Request,
  res: Response,
  admin: SupabaseClient,
  engagement: ReturnType<typeof createEngagementService>,
  product: CatalogProduct,
  destination: ShoppingResolution,
  requestedProductId: string,
): Promise<void> {
  const videoId = queryString(req.query.videoId);
  const collectionId = queryString(req.query.collectionId);
  const collectionProductTagId = queryString(req.query.tagId);
  let creatorId = queryString(req.query.creatorId);
  if (!creatorId && videoId) {
    const { data: video } = await admin
      .from('videos')
      .select('curator_id')
      .eq('id', videoId)
      .maybeSingle();
    creatorId = (video?.curator_id as string | null) ?? null;
  }

  const platform =
    queryString(req.query.platform) ?? headerString(req.headers['sec-ch-ua-platform']) ?? null;
  const country = resolveRequestCountry(req);
  const userId = await authenticatedUserId(req);
  const timestamp = new Date().toISOString();
  const eventId = queryString(req.query.eventId) ?? randomUUID();
  const analytics = {
    productId: product.id,
    requestedProductId,
    creatorId,
    videoId,
    collectionId,
    collectionProductTagId,
    userId,
    destinationUrl: destination.url,
    shoppingProvider: destination.shoppingProvider,
    affiliateProvider: destination.affiliateProvider,
    timestamp,
    platform,
    country,
    eventId,
  };

  logger.info(analytics, 'shopping.redirect.started');

  const { error } = await admin.from('product_clicks').insert({
    catalog_product_id: product.id,
    video_id: videoId,
    creator_id: creatorId,
    user_id: userId,
    destination_url: destination.url,
    destination_type: destination.destinationType,
    shopping_provider: destination.shoppingProvider,
    affiliate_provider: destination.affiliateProvider,
    platform,
    country,
    created_at: timestamp,
  });
  if (error) {
    logger.error({ ...analytics, error: error.message }, 'shopping.redirect.analytics_failed');
  }

  try {
    await engagement.recordMerchantClicked({
      eventId,
      actorUserId: userId,
      catalogProductId: product.id,
      collectionId,
      collectionProductTagId,
      creatorId,
      destinationUrl: destination.url,
      destinationType: destination.destinationType,
      shoppingProvider: destination.shoppingProvider,
      affiliateProvider: destination.affiliateProvider,
      platform,
      country,
      occurredAt: timestamp,
    });
  } catch (e) {
    logger.error(
      {
        ...analytics,
        error: e instanceof Error ? e.message : String(e),
      },
      'shopping.redirect.engagement_failed',
    );
  }

  logger.info(analytics, 'shopping.redirect.completed');
  if (wantsJson(req)) {
    res.json({
      url: destination.url,
      merchantName: destination.merchantName ?? product.merchant ?? null,
      country,
    });
    return;
  }
  res.redirect(302, destination.url);
}

export function createProductRedirectHandler(admin: SupabaseClient) {
  const catalog = createCatalogService(admin);
  const discovered = createDiscoveredProductService(admin);
  const engagement = createEngagementService(admin);
  const resolver = new ShoppingResolver(new AffiliateService(getAffiliateConfig()));

  return async (req: Request, res: Response): Promise<void> => {
    const productId = req.params.id;
    const offerId = queryString(req.query.offerId);
    const country = resolveRequestCountry(req);
    const product = await catalog.resolveActiveProduct(productId);
    if (product && product.status !== 'HIDDEN') {
      const destination = resolver.resolve(product, { offerId, country });
      if (!destination) {
        res.status(404).json({ error: 'No shopping destination is available for this product' });
        return;
      }
      await redirectCatalog(req, res, admin, engagement, product, destination, productId);
      return;
    }

    const imported = await discovered.getById(productId);
    if (!imported || imported.internalStatus !== 'ACTIVE') {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const source = discoveredShoppingSource(imported);
    const dest = offerId
      ? findStoredShoppingDestination(source, offerId)
      : listStoredShoppingDestinations(source)[0] ?? null;
    const baseUrl = dest?.url ?? imported.merchantUrl;
    const regional = dest
      ? resolveMerchantRegion({ url: dest.url, regionalUrls: dest.regionalUrls }, country)
      : { url: validHttpUrl(baseUrl) ?? '', usedRegional: false };
    const listing = validHttpUrl(regional.url);
    if (!listing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    logger.info({ productId, offerId, destinationUrl: listing, country }, 'shopping.redirect.listing');
    if (wantsJson(req)) {
      res.json({
        url: listing,
        merchantName: dest?.merchant ?? imported.merchant ?? null,
        country,
      });
      return;
    }
    res.redirect(302, listing);
  };
}
