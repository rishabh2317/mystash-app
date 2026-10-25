import type { Brand, BrandFeedRun, Campaign, CampaignProduct, CampaignOffering } from './domain/types';

export type CreateBrandInput = { name: string; slug: string };

export type CreateCampaignInput = {
  brandId: string;
  name: string;
  slug: string;
  eligibility?: Campaign['eligibility'];
  status?: Campaign['status'];
  startsAt?: string | null;
  endsAt?: string | null;
};

export type UpsertCampaignProductInput = {
  campaignId: string;
  catalogProductId: string;
  sku: string;
  buyUrl: string | null;
  commercialSource: CampaignProduct['commercialSource'];
  provenance: CampaignProduct['provenance'];
  name: string;
  brand: string | null;
};

export interface BrandCampaignRepository {
  createBrand(input: CreateBrandInput): Promise<Brand>;
  findBrand(id: string): Promise<Brand | null>;
  createCampaign(input: CreateCampaignInput): Promise<Campaign>;
  findCampaign(id: string): Promise<Campaign | null>;
  allowlistCreator(campaignId: string, userId: string): Promise<void>;
  isAllowlisted(campaignId: string, userId: string): Promise<boolean>;
  findProductBySku(campaignId: string, sku: string): Promise<CampaignProduct | null>;
  upsertProduct(input: UpsertCampaignProductInput): Promise<{ product: CampaignProduct; created: boolean }>;
  listOfferings(): Promise<CampaignOffering[]>;
  findOffering(campaignProductId: string): Promise<CampaignOffering | null>;
  startFeedRun(brandId: string, campaignId: string): Promise<BrandFeedRun>;
  finishFeedRun(
    id: string,
    patch: Pick<BrandFeedRun, 'status' | 'itemCount' | 'createdCount' | 'matchedCount' | 'error'>,
  ): Promise<BrandFeedRun>;
}
