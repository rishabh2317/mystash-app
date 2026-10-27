import { UUID } from '../analytics/contracts';
import { requestMeasurement } from '../analytics/context';
import { recordOutboundObservation } from '../analytics/serverEvents';
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { optionalVerifiedUserId } from '../auth/requireAuth';
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
import { resolveRedirectAttribution } from './redirectAttribution';

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
  return optionalVerifiedUserId(req);
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
  const userId = await authenticatedUserId(req);
  const attribution = await resolveRedirectAttribution(admin, {
    productId: product.id, collectionId: queryString(req.query.collectionId),
    tagId: queryString(req.query.tagId), videoId: queryString(req.query.videoId), userId,
  }).catch(() => ({ collectionId: null, tagId: null, creatorId: null, videoId: null }));
  const { collectionId, creatorId, videoId } = attribution;
  const collectionProductTagId = attribution.tagId;

  const platform =
    queryString(req.query.platform) ?? headerString(req.headers['sec-ch-ua-platform']) ?? null;
  const country = resolveRequestCountry(req);
  const timestamp = new Date().toISOString();
  const suppliedEventId=queryString(req.query.eventId);
  const eventId=suppliedEventId&&UUID.test(suppliedEventId)?suppliedEventId:randomUUID();
  const analytics = {
    productId: product.id,
    requestedProductId,
    creatorId,
    videoId,
    collectionId,
    collectionProductTagId,
    authenticated: Boolean(userId),
    destinationHost: new URL(destination.url).hostname,
    shoppingProvider: destination.shoppingProvider,
    affiliateProvider: destination.affiliateProvider,
    timestamp,
    platform,
    country,
    eventId,
  };

  logger.info(analytics, 'shopping.redirect.started');

  const measurementRequested=!!req.headers['x-mystash-session'];
  const clickRow={
    event_id: eventId,
    catalog_product_id: product.id,
    video_id: videoId,
    creator_id: creatorId,
    user_id: userId,
    destination_url: new URL(destination.url).origin,
    destination_type: destination.destinationType,
    shopping_provider: destination.shoppingProvider,
    affiliate_provider: destination.affiliateProvider,
    platform,
    country,
    created_at: timestamp,
  };
  const {error}=await admin.rpc('analytics_record_legacy_click',{p_user_id:userId,p_revision:requestMeasurement(req)?.revision??null,p_row:clickRow});
  if (error) {
    logger.error({ ...analytics, error: error.message }, 'shopping.redirect.analytics_failed');
  }

  try {
    await engagement.recordMerchantClicked({
      eventId,
      measurementRequested,
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

  await recordOutboundObservation(admin,req,userId,{productId:product.id,namespace:'catalog',collectionId,
    destinationKind:destination.destinationType,affiliate:!!destination.affiliateProvider});
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
    await recordOutboundObservation(admin,req,await authenticatedUserId(req),{productId:imported.id,namespace:'discovered',
      destinationKind:'listing',affiliate:false});
    logger.info({ productId, offerId, destinationHost: new URL(listing).hostname, country }, 'shopping.redirect.listing');
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
