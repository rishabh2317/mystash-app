import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BrandCampaignRepository,
  CreateBrandInput,
  CreateCampaignInput,
  UpsertCampaignProductInput,
} from './BrandCampaignRepository';
import type { Brand, BrandFeedRun, Campaign, CampaignOffering, CampaignProduct } from './domain/types';

type Row = Record<string, unknown>;

function mapBrand(row: Row): Brand {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    status: row.status === 'suspended' ? 'suspended' : 'active',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCampaign(row: Row): Campaign {
  return {
    id: String(row.id),
    brandId: String(row.brand_id),
    name: String(row.name),
    slug: String(row.slug),
    status: row.status === 'draft' || row.status === 'ended' ? row.status : 'active',
    eligibility: row.eligibility === 'allowlist' ? 'allowlist' : 'all_active_creators',
    startsAt: (row.starts_at as string) ?? null,
    endsAt: (row.ends_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProduct(row: Row): CampaignProduct {
  const provenance = row.provenance === 'CAMPAIGN' ? 'CAMPAIGN' : 'BRAND_FEED';
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    catalogProductId: String(row.catalog_product_id),
    sku: String(row.sku),
    buyUrl: (row.buy_url as string) ?? null,
    commercialSource: row.commercial_source === 'CAMPAIGN' ? 'CAMPAIGN' : 'BRAND_FEED',
    provenance,
    name: String(row.name),
    brand: (row.brand as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SupabaseBrandCampaignRepository implements BrandCampaignRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async createBrand(input: CreateBrandInput): Promise<Brand> {
    const { data, error } = await this.admin
      .from('brands')
      .insert({ name: input.name, slug: input.slug })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to create brand');
    return mapBrand(data as Row);
  }

  async findBrand(id: string): Promise<Brand | null> {
    const { data, error } = await this.admin.from('brands').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapBrand(data as Row) : null;
  }

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const { data, error } = await this.admin
      .from('campaigns')
      .insert({
        brand_id: input.brandId,
        name: input.name,
        slug: input.slug,
        status: input.status ?? 'active',
        eligibility: input.eligibility ?? 'all_active_creators',
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to create campaign');
    return mapCampaign(data as Row);
  }

  async findCampaign(id: string): Promise<Campaign | null> {
    const { data, error } = await this.admin.from('campaigns').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapCampaign(data as Row) : null;
  }

  async allowlistCreator(campaignId: string, userId: string): Promise<void> {
    const { error } = await this.admin
      .from('campaign_creator_eligibility')
      .upsert({ campaign_id: campaignId, user_id: userId }, { onConflict: 'campaign_id,user_id' });
    if (error) throw new Error(error.message);
  }

  async isAllowlisted(campaignId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from('campaign_creator_eligibility')
      .select('user_id')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
  }

  async findProductBySku(campaignId: string, sku: string): Promise<CampaignProduct | null> {
    const { data, error } = await this.admin
      .from('campaign_products')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('sku', sku)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapProduct(data as Row) : null;
  }

  async upsertProduct(
    input: UpsertCampaignProductInput,
  ): Promise<{ product: CampaignProduct; created: boolean }> {
    const existing = await this.findProductBySku(input.campaignId, input.sku);
    if (existing) {
      const { data, error } = await this.admin
        .from('campaign_products')
        .update({
          buy_url: input.buyUrl,
          name: input.name,
          brand: input.brand,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to update campaign product');
      return { product: mapProduct(data as Row), created: false };
    }
    const { data, error } = await this.admin
      .from('campaign_products')
      .insert({
        campaign_id: input.campaignId,
        catalog_product_id: input.catalogProductId,
        sku: input.sku,
        buy_url: input.buyUrl,
        commercial_source: input.commercialSource,
        provenance: input.provenance,
        name: input.name,
        brand: input.brand,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to insert campaign product');
    return { product: mapProduct(data as Row), created: true };
  }

  async listOfferings(): Promise<CampaignOffering[]> {
    const { data, error } = await this.admin
      .from('campaign_products')
      .select('*, campaigns!inner(name, brand_id, brands!inner(name))');
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const product = mapProduct(row as Row);
      const campaign = (row as Row).campaigns as Row | Row[] | null;
      const campaignRow = Array.isArray(campaign) ? campaign[0] : campaign;
      const brand = campaignRow?.brands as Row | Row[] | null;
      const brandRow = Array.isArray(brand) ? brand[0] : brand;
      return {
        ...product,
        campaignName: String(campaignRow?.name ?? ''),
        brandId: String(campaignRow?.brand_id ?? ''),
        brandName: String(brandRow?.name ?? ''),
      };
    });
  }

  async findOffering(campaignProductId: string): Promise<CampaignOffering | null> {
    const offerings = await this.listOfferings();
    return offerings.find((row) => row.id === campaignProductId) ?? null;
  }

  async startFeedRun(brandId: string, campaignId: string): Promise<BrandFeedRun> {
    const { data, error } = await this.admin
      .from('brand_feed_runs')
      .insert({ brand_id: brandId, campaign_id: campaignId, status: 'running' })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to start feed run');
    return mapRun(data as Row);
  }

  async finishFeedRun(
    id: string,
    patch: Pick<BrandFeedRun, 'status' | 'itemCount' | 'createdCount' | 'matchedCount' | 'error'>,
  ): Promise<BrandFeedRun> {
    const { data, error } = await this.admin
      .from('brand_feed_runs')
      .update({
        status: patch.status,
        item_count: patch.itemCount,
        created_count: patch.createdCount,
        matched_count: patch.matchedCount,
        error: patch.error,
        finished_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to finish feed run');
    return mapRun(data as Row);
  }
}

function mapRun(row: Row): BrandFeedRun {
  const status = row.status === 'completed' || row.status === 'failed' ? row.status : 'running';
  return {
    id: String(row.id),
    brandId: String(row.brand_id),
    campaignId: String(row.campaign_id),
    status,
    itemCount: Number(row.item_count ?? 0),
    createdCount: Number(row.created_count ?? 0),
    matchedCount: Number(row.matched_count ?? 0),
    error: (row.error as string) ?? null,
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string) ?? null,
  };
}
