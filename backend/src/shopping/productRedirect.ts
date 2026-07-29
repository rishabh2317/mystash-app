import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { createSupabaseUserClient } from '../supabase';
import { SupabaseCatalogRepository } from '../product-intelligence/catalog/SupabaseCatalogRepository';
import { AffiliateService } from './AffiliateService';
import { getAffiliateConfig } from './affiliateConfig';
import { ShoppingResolver } from './ShoppingResolver';

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function headerString(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
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

export function createProductRedirectHandler(admin: SupabaseClient) {
  const catalog = new SupabaseCatalogRepository(admin);
  const resolver = new ShoppingResolver(new AffiliateService(getAffiliateConfig()));

  return async (req: Request, res: Response): Promise<void> => {
    const productId = req.params.id;
    const product = await catalog.findById(productId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const destination = resolver.resolve(product);
    if (!destination) {
      res.status(404).json({ error: 'No shopping destination is available for this product' });
      return;
    }

    const videoId = queryString(req.query.videoId);
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
    const country =
      queryString(req.query.country) ??
      headerString(req.headers['cf-ipcountry']) ??
      headerString(req.headers['x-vercel-ip-country']) ??
      null;
    const userId = await authenticatedUserId(req);
    const timestamp = new Date().toISOString();
    const analytics = {
      productId,
      creatorId,
      videoId,
      userId,
      destinationUrl: destination.url,
      shoppingProvider: destination.shoppingProvider,
      affiliateProvider: destination.affiliateProvider,
      timestamp,
      platform,
      country,
    };

    logger.info(analytics, 'shopping.redirect.started');
    const { error } = await admin.from('product_clicks').insert({
      catalog_product_id: productId,
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
      // Preserve the shopping journey while retaining the analytics event in structured logs.
      logger.error({ ...analytics, error: error.message }, 'shopping.redirect.analytics_failed');
    }

    logger.info(analytics, 'shopping.redirect.completed');
    res.redirect(302, destination.url);
  };
}
