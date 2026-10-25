export type BrandStatus = 'active' | 'suspended';

export type CampaignStatus = 'draft' | 'active' | 'ended';

export type CampaignEligibility = 'all_active_creators' | 'allowlist';

export type CampaignCommercialSource = 'CAMPAIGN' | 'BRAND_FEED';

export type Brand = {
  id: string;
  name: string;
  slug: string;
  status: BrandStatus;
  createdAt: string;
  updatedAt: string;
};

export type Campaign = {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  eligibility: CampaignEligibility;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignProduct = {
  id: string;
  campaignId: string;
  catalogProductId: string;
  sku: string;
  buyUrl: string | null;
  commercialSource: CampaignCommercialSource;
  provenance: CampaignCommercialSource;
  name: string;
  brand: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandFeedRun = {
  id: string;
  brandId: string;
  campaignId: string;
  status: 'running' | 'completed' | 'failed';
  itemCount: number;
  createdCount: number;
  matchedCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type BrandFeedItem = {
  sku: string;
  name: string;
  brand?: string | null;
  merchantUrl?: string | null;
  buyUrl?: string | null;
  imageUrl?: string | null;
  price?: string | null;
  currency?: string | null;
};

export type CampaignOffering = CampaignProduct & {
  campaignName: string;
  brandId: string;
  brandName: string;
};
