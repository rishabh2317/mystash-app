import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentSourceRepository } from '../content-source/ContentSourceRepository';
import { attachmentExternalId } from '../creator-library/LibraryProductService';
import type { CreatorLibraryRepository } from '../creator-library/CreatorLibraryRepository';
import type { CreatorStatus } from '../user/domain/types';
import type { BrandCampaignRepository } from './BrandCampaignRepository';
import { InMemoryBrandCampaignRepository } from './InMemoryBrandCampaignRepository';
import { SupabaseBrandCampaignRepository } from './SupabaseBrandCampaignRepository';
import { creatorCanSeeCampaign } from './eligibility';
import { matchBrandFeedIdentity, normalizeBrandFeedName, slugifyBrandFeed } from './matchCatalog';
import type { Brand, BrandFeedItem, BrandFeedRun, Campaign, CampaignOffering } from './domain/types';

export class BrandCampaignError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BrandCampaignError';
  }
}

export type BrandFeedCatalogRow = {
  id: string;
  merchantUrl: string | null;
  brand: string | null;
  normalizedName: string;
  name: string;
};

export type BrandFeedCatalog = {
  listIdentity(): Promise<BrandFeedCatalogRow[]>;
  create(input: {
    name: string;
    normalizedName: string;
    canonicalSlug: string;
    brand: string | null;
    imageUrl: string | null;
    merchantUrl: string | null;
    price: string | null;
    currency: string | null;
    buyUrl: string | null;
  }): Promise<BrandFeedCatalogRow>;
};

export class BrandCampaignService {
  constructor(
    private readonly brands: BrandCampaignRepository,
    private readonly catalog: BrandFeedCatalog,
    private readonly library?: CreatorLibraryRepository,
    private readonly sources?: ContentSourceRepository,
  ) {}

  createBrand(name: string): Promise<Brand> {
    const trimmed = name.trim();
    if (!trimmed) throw new BrandCampaignError('Brand name is required', 400);
    return this.brands.createBrand({ name: trimmed, slug: slugifyBrandFeed(trimmed) });
  }

  async createCampaign(input: {
    brandId: string;
    name: string;
    eligibility?: Campaign['eligibility'];
  }): Promise<Campaign> {
    const brand = await this.brands.findBrand(input.brandId);
    if (!brand || brand.status !== 'active') throw new BrandCampaignError('Brand not found', 404);
    const name = input.name.trim();
    if (!name) throw new BrandCampaignError('Campaign name is required', 400);
    return this.brands.createCampaign({
      brandId: brand.id,
      name,
      slug: slugifyBrandFeed(name),
      eligibility: input.eligibility ?? 'all_active_creators',
      status: 'active',
    });
  }

  async ingestFeed(input: {
    brandId: string;
    campaignId: string;
    items: BrandFeedItem[];
  }): Promise<BrandFeedRun> {
    const campaign = await this.brands.findCampaign(input.campaignId);
    if (!campaign || campaign.brandId !== input.brandId) {
      throw new BrandCampaignError('Campaign not found', 404);
    }
    for (const item of input.items) {
      if (!item.sku?.trim() || !item.name?.trim()) {
        throw new BrandCampaignError('Each feed item needs a sku and name', 400);
      }
    }
    const run = await this.brands.startFeedRun(input.brandId, input.campaignId);
    let createdCount = 0;
    let matchedCount = 0;
    const identity = await this.catalog.listIdentity();
    try {
      for (const item of input.items) {
        const sku = item.sku.trim();
        const existingSku = await this.brands.findProductBySku(campaign.id, sku);
        let catalogId = existingSku?.catalogProductId ?? null;
        if (catalogId) {
          matchedCount += 1;
        } else {
          const normalizedName = normalizeBrandFeedName(item.name);
          catalogId = matchBrandFeedIdentity(
            { merchantUrl: item.merchantUrl, brand: item.brand, normalizedName },
            identity,
          );
          if (catalogId) {
            matchedCount += 1;
          } else {
            const created = await this.catalog.create({
              name: item.name.trim(),
              normalizedName,
              canonicalSlug: `bf-${slugifyBrandFeed(item.brand || 'brand')}-${slugifyBrandFeed(sku)}`,
              brand: item.brand?.trim() || null,
              imageUrl: item.imageUrl ?? null,
              merchantUrl: item.merchantUrl?.trim() || null,
              price: item.price ?? null,
              currency: item.currency ?? null,
              buyUrl: item.buyUrl ?? null,
            });
            catalogId = created.id;
            identity.push(created);
            createdCount += 1;
          }
        }
        await this.brands.upsertProduct({
          campaignId: campaign.id,
          catalogProductId: catalogId,
          sku,
          buyUrl: item.buyUrl?.trim() || null,
          commercialSource: 'BRAND_FEED',
          provenance: 'BRAND_FEED',
          name: item.name.trim(),
          brand: item.brand?.trim() || null,
        });
      }
      return await this.brands.finishFeedRun(run.id, {
        status: 'completed',
        itemCount: input.items.length,
        createdCount,
        matchedCount,
        error: null,
      });
    } catch (error) {
      await this.brands.finishFeedRun(run.id, {
        status: 'failed',
        itemCount: input.items.length,
        createdCount,
        matchedCount,
        error: error instanceof Error ? error.message : 'Feed failed',
      });
      throw error;
    }
  }

  async listEligibleOfferings(input: {
    userId: string;
    creatorStatus: CreatorStatus;
    nowIso?: string;
  }): Promise<CampaignOffering[]> {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const offerings = await this.brands.listOfferings();
    const visible: CampaignOffering[] = [];
    const seenCampaigns = new Map<string, boolean>();
    for (const offering of offerings) {
      let open = seenCampaigns.get(offering.campaignId);
      if (open === undefined) {
        const campaign = await this.brands.findCampaign(offering.campaignId);
        const allowlisted = campaign
          ? await this.brands.isAllowlisted(campaign.id, input.userId)
          : false;
        open = Boolean(
          campaign &&
            creatorCanSeeCampaign({
              campaign,
              creatorStatus: input.creatorStatus,
              allowlisted,
              nowIso,
            }),
        );
        seenCampaigns.set(offering.campaignId, open);
      }
      if (open) visible.push(offering);
    }
    return visible;
  }

  async attachOffering(input: {
    userId: string;
    creatorStatus: CreatorStatus;
    contentSourceId: string;
    campaignProductId: string;
  }): Promise<{ catalogProductId: string; created: boolean }> {
    if (!this.library || !this.sources) {
      throw new BrandCampaignError('Library attachment is not configured', 500);
    }
    const owns = await this.library.userOwnsContentSource(input.userId, input.contentSourceId);
    if (!owns) throw new BrandCampaignError('Library item not found', 404);
    const offering = await this.requireEligibleOffering(input);
    const externalId = attachmentExternalId('catalog', offering.catalogProductId);
    const existing = await this.sources.findProductByExternalId(input.contentSourceId, externalId);
    if (existing) return { catalogProductId: offering.catalogProductId, created: false };
    const current = await this.sources.listProducts(input.contentSourceId);
    await this.sources.insertProduct({
      contentSourceId: input.contentSourceId,
      position: current.length,
      externalId,
      name: offering.name,
      brand: offering.brand,
      model: null,
      category: null,
      price: null,
      currency: null,
      image: null,
      merchantUrl: offering.buyUrl,
      confidence: null,
      extractionMethod: 'creator_manual',
      sources: ['brand_campaign'],
      evidence: { campaignProductId: offering.id, attachmentSource: offering.provenance },
      processorVersion: 'brand-campaign-attach',
      catalogProductId: offering.catalogProductId,
      attachmentSource: offering.provenance,
    });
    return { catalogProductId: offering.catalogProductId, created: true };
  }

  private async requireEligibleOffering(input: {
    userId: string;
    creatorStatus: CreatorStatus;
    campaignProductId: string;
  }): Promise<CampaignOffering> {
    const offering = await this.brands.findOffering(input.campaignProductId);
    if (!offering) throw new BrandCampaignError('Campaign product not found', 404);
    const visible = await this.listEligibleOfferings(input);
    if (!visible.some((row) => row.id === offering.id)) {
      throw new BrandCampaignError('Campaign product is not available', 404);
    }
    return offering;
  }
}

export function createBrandCampaignService(
  admin: SupabaseClient,
  catalog: BrandFeedCatalog,
  library?: CreatorLibraryRepository,
  sources?: ContentSourceRepository,
): BrandCampaignService {
  return new BrandCampaignService(new SupabaseBrandCampaignRepository(admin), catalog, library, sources);
}

export { InMemoryBrandCampaignRepository };
