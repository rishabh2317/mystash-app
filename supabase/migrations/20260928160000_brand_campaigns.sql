-- Phase 7: brand, campaign, and feed edges. Product identity stays catalog_products.

CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  eligibility text NOT NULL DEFAULT 'all_active_creators'
    CHECK (eligibility IN ('all_active_creators', 'allowlist')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, slug)
);

CREATE TABLE IF NOT EXISTS public.campaign_creator_eligibility (
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products (id),
  sku text NOT NULL,
  buy_url text,
  name text NOT NULL,
  brand text,
  commercial_source text NOT NULL DEFAULT 'CAMPAIGN'
    CHECK (commercial_source IN ('CAMPAIGN', 'BRAND_FEED')),
  provenance text NOT NULL DEFAULT 'CAMPAIGN'
    CHECK (provenance IN ('CAMPAIGN', 'BRAND_FEED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, sku),
  UNIQUE (campaign_id, catalog_product_id)
);

CREATE INDEX IF NOT EXISTS campaign_products_catalog_idx
  ON public.campaign_products (catalog_product_id);

CREATE TABLE IF NOT EXISTS public.brand_feed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  item_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE public.collection_product_tags
  ADD COLUMN IF NOT EXISTS campaign_product_id uuid REFERENCES public.campaign_products (id);

ALTER TABLE public.collection_product_tags
  DROP CONSTRAINT IF EXISTS collection_product_tags_selection_source_check;
ALTER TABLE public.collection_product_tags
  ADD CONSTRAINT collection_product_tags_selection_source_check
  CHECK (selection_source IN (
    'AI_DETECTED',
    'AI_RECOMMENDED',
    'CREATOR_MANUAL',
    'CREATOR_ACCEPTED_AI',
    'IMPORT',
    'SYSTEM',
    'CAMPAIGN',
    'BRAND_FEED'
  ));

ALTER TABLE public.content_source_products
  DROP CONSTRAINT IF EXISTS content_source_products_attachment_source_check;
ALTER TABLE public.content_source_products
  ADD CONSTRAINT content_source_products_attachment_source_check
  CHECK (
    attachment_source IS NULL
    OR attachment_source IN (
      'AI_DETECTED',
      'AI_RECOMMENDED',
      'CREATOR_MANUAL',
      'CREATOR_ACCEPTED_AI',
      'IMPORT',
      'SYSTEM',
      'CAMPAIGN',
      'BRAND_FEED'
    )
  );

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_creator_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_feed_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.campaign_products IS
  'Commercial edge from a campaign to catalog_products. Not a product identity table.';
