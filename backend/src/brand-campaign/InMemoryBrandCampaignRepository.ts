import { randomUUID } from 'node:crypto';
import type {
  BrandCampaignRepository,
  CreateBrandInput,
  CreateCampaignInput,
  UpsertCampaignProductInput,
} from './BrandCampaignRepository';
import type { Brand, BrandFeedRun, Campaign, CampaignOffering, CampaignProduct } from './domain/types';

function now(): string {
  return new Date().toISOString();
}

export class InMemoryBrandCampaignRepository implements BrandCampaignRepository {
  brands = new Map<string, Brand>();
  campaigns = new Map<string, Campaign>();
  products = new Map<string, CampaignProduct>();
  allowlist = new Set<string>();
  runs = new Map<string, BrandFeedRun>();

  async createBrand(input: CreateBrandInput): Promise<Brand> {
    const ts = now();
    const brand: Brand = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    };
    this.brands.set(brand.id, brand);
    return brand;
  }

  async findBrand(id: string): Promise<Brand | null> {
    return this.brands.get(id) ?? null;
  }

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const ts = now();
    const campaign: Campaign = {
      id: randomUUID(),
      brandId: input.brandId,
      name: input.name,
      slug: input.slug,
      status: input.status ?? 'active',
      eligibility: input.eligibility ?? 'all_active_creators',
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  async findCampaign(id: string): Promise<Campaign | null> {
    return this.campaigns.get(id) ?? null;
  }

  async allowlistCreator(campaignId: string, userId: string): Promise<void> {
    this.allowlist.add(`${campaignId}:${userId}`);
  }

  async isAllowlisted(campaignId: string, userId: string): Promise<boolean> {
    return this.allowlist.has(`${campaignId}:${userId}`);
  }

  async findProductBySku(campaignId: string, sku: string): Promise<CampaignProduct | null> {
    return (
      [...this.products.values()].find((row) => row.campaignId === campaignId && row.sku === sku) ?? null
    );
  }

  async upsertProduct(
    input: UpsertCampaignProductInput,
  ): Promise<{ product: CampaignProduct; created: boolean }> {
    const existing = await this.findProductBySku(input.campaignId, input.sku);
    const ts = now();
    if (existing) {
      const next: CampaignProduct = {
        ...existing,
        catalogProductId: existing.catalogProductId,
        buyUrl: input.buyUrl,
        name: input.name,
        brand: input.brand,
        updatedAt: ts,
      };
      this.products.set(existing.id, next);
      return { product: next, created: false };
    }
    const product: CampaignProduct = {
      id: randomUUID(),
      campaignId: input.campaignId,
      catalogProductId: input.catalogProductId,
      sku: input.sku,
      buyUrl: input.buyUrl,
      commercialSource: input.commercialSource,
      provenance: input.provenance,
      name: input.name,
      brand: input.brand,
      createdAt: ts,
      updatedAt: ts,
    };
    this.products.set(product.id, product);
    return { product, created: true };
  }

  async listOfferings(): Promise<CampaignOffering[]> {
    return [...this.products.values()].map((product) => this.toOffering(product));
  }

  async findOffering(campaignProductId: string): Promise<CampaignOffering | null> {
    const product = this.products.get(campaignProductId);
    return product ? this.toOffering(product) : null;
  }

  async startFeedRun(brandId: string, campaignId: string): Promise<BrandFeedRun> {
    const run: BrandFeedRun = {
      id: randomUUID(),
      brandId,
      campaignId,
      status: 'running',
      itemCount: 0,
      createdCount: 0,
      matchedCount: 0,
      error: null,
      startedAt: now(),
      finishedAt: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async finishFeedRun(
    id: string,
    patch: Pick<BrandFeedRun, 'status' | 'itemCount' | 'createdCount' | 'matchedCount' | 'error'>,
  ): Promise<BrandFeedRun> {
    const existing = this.runs.get(id);
    if (!existing) throw new Error('Feed run not found');
    const next: BrandFeedRun = { ...existing, ...patch, finishedAt: now() };
    this.runs.set(id, next);
    return next;
  }

  private toOffering(product: CampaignProduct): CampaignOffering {
    const campaign = this.campaigns.get(product.campaignId);
    const brand = campaign ? this.brands.get(campaign.brandId) : undefined;
    return {
      ...product,
      campaignName: campaign?.name ?? '',
      brandId: campaign?.brandId ?? '',
      brandName: brand?.name ?? '',
    };
  }
}
