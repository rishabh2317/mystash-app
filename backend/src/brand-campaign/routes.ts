import type { Express, Request, Response } from 'express';
import { getEnv } from '../env';
import { logger } from '../logger';
import { requireAuthUser } from '../auth/requireAuth';
import { createSupabaseAdmin } from '../supabase';
import { SupabaseContentSourceRepository } from '../content-source/SupabaseContentSourceRepository';
import { SupabaseCreatorLibraryRepository } from '../creator-library/SupabaseCreatorLibraryRepository';
import { createUserService } from '../user/factory';
import { BrandCampaignError, BrandCampaignService } from './BrandCampaignService';
import { SupabaseBrandCampaignRepository } from './SupabaseBrandCampaignRepository';
import { supabaseBrandFeedCatalog } from './supabaseCatalog';
import type { BrandFeedItem } from './domain/types';

function feedKeyOk(req: Request): boolean {
  const expected = getEnv('BRAND_FEED_INGEST_KEY');
  if (!expected) return false;
  return req.header('x-mystash-brand-feed-key') === expected;
}

function service(): BrandCampaignService {
  const admin = createSupabaseAdmin();
  return new BrandCampaignService(
    new SupabaseBrandCampaignRepository(admin),
    supabaseBrandFeedCatalog(admin),
    new SupabaseCreatorLibraryRepository(admin),
    new SupabaseContentSourceRepository(admin),
  );
}

function handle(res: Response, error: unknown): void {
  if (error instanceof BrandCampaignError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  logger.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
}

async function requireUser(req: Request, res: Response) {
  return requireAuthUser(req, res, { requireVerifiedEmail: true });
}

export function registerBrandCampaignRoutes(app: Express): void {
  app.post('/brands', async (req, res) => {
    try {
      if (!feedKeyOk(req)) {
        res.status(403).json({ error: 'Brand feed ingest is not configured' });
        return;
      }
      const name = String((req.body as { name?: string } | undefined)?.name ?? '');
      const brand = await service().createBrand(name);
      res.status(201).json({ brand });
    } catch (error) {
      handle(res, error);
    }
  });

  app.post('/brands/:brandId/campaigns', async (req, res) => {
    try {
      if (!feedKeyOk(req)) {
        res.status(403).json({ error: 'Brand feed ingest is not configured' });
        return;
      }
      const body = (req.body ?? {}) as { name?: string; eligibility?: 'all_active_creators' | 'allowlist' };
      const campaign = await service().createCampaign({
        brandId: String(req.params.brandId),
        name: String(body.name ?? ''),
        eligibility: body.eligibility,
      });
      res.status(201).json({ campaign });
    } catch (error) {
      handle(res, error);
    }
  });

  app.post('/brands/:brandId/campaigns/:campaignId/feed', async (req, res) => {
    try {
      if (!feedKeyOk(req)) {
        res.status(403).json({ error: 'Brand feed ingest is not configured' });
        return;
      }
      const items = ((req.body ?? {}) as { items?: BrandFeedItem[] }).items;
      if (!Array.isArray(items)) {
        res.status(400).json({ error: 'Feed items are required' });
        return;
      }
      const run = await service().ingestFeed({
        brandId: String(req.params.brandId),
        campaignId: String(req.params.campaignId),
        items,
      });
      res.status(201).json({ run });
    } catch (error) {
      handle(res, error);
    }
  });

  app.get('/users/me/campaign-products', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const profile = await createUserService(admin).ensureFromAuth(user);
      const offerings = await service().listEligibleOfferings({
        userId: user.id,
        creatorStatus: profile.creatorStatus,
      });
      res.json({
        products: offerings.map((row) => ({
          campaignProductId: row.id,
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          brandName: row.brandName,
          catalogProductId: row.catalogProductId,
          name: row.name,
          sku: row.sku,
          provenance: row.provenance,
        })),
      });
    } catch (error) {
      handle(res, error);
    }
  });

  app.post('/users/me/library/items/:contentSourceId/campaign-products', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const profile = await createUserService(admin).ensureFromAuth(user);
      const campaignProductId = String(
        (req.body as { campaignProductId?: string } | undefined)?.campaignProductId ?? '',
      );
      const result = await service().attachOffering({
        userId: user.id,
        creatorStatus: profile.creatorStatus,
        contentSourceId: String(req.params.contentSourceId),
        campaignProductId,
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      handle(res, error);
    }
  });
}
