-- Product Intelligence & Catalog (Phase 2)
-- Global catalog, normalized search cache, draft/video resolution fields.
-- Backward compatible: new columns nullable; existing affiliate_links kept.

-- ---------------------------------------------------------------------------
-- catalog_products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_slug text NOT NULL,
  brand text,
  name text NOT NULL,
  normalized_name text NOT NULL,
  model text,
  category text,
  description text,
  image_url text,
  merchant text,
  merchant_url text,
  affiliate_url text,
  currency text,
  price text,
  rating numeric,
  review_count integer,
  availability text,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISCONTINUED', 'MERGED', 'HIDDEN')),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED', 'UNRESOLVED')),
  verification_source text,
  verification_version text,
  last_verified_at timestamptz,
  ai_confidence numeric,
  match_confidence numeric,
  verification_confidence numeric,
  merged_into_id uuid REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_slug)
);

CREATE INDEX IF NOT EXISTS catalog_products_normalized_name_idx
  ON public.catalog_products (normalized_name);
CREATE INDEX IF NOT EXISTS catalog_products_brand_model_idx
  ON public.catalog_products (brand, model);
CREATE INDEX IF NOT EXISTS catalog_products_verification_idx
  ON public.catalog_products (verification_status);
CREATE INDEX IF NOT EXISTS catalog_products_status_idx
  ON public.catalog_products (status);
CREATE INDEX IF NOT EXISTS catalog_products_merchant_url_idx
  ON public.catalog_products (merchant_url);

-- ---------------------------------------------------------------------------
-- catalog_aliases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalog_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products (id) ON DELETE CASCADE,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_product_id, alias)
);

CREATE INDEX IF NOT EXISTS catalog_aliases_alias_idx
  ON public.catalog_aliases (alias);

-- ---------------------------------------------------------------------------
-- Normalized search candidate cache (business logic — not raw provider JSON)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalog_search_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  provider text NOT NULL,
  merchant text,
  merchant_url text NOT NULL,
  title text,
  image text,
  score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS catalog_search_candidates_query_provider_idx
  ON public.catalog_search_candidates (query, provider, expires_at);

-- Optional raw payloads for debugging only
CREATE TABLE IF NOT EXISTS public.catalog_search_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  provider text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- product_match_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_match_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES public.ingest_draft_products (id) ON DELETE SET NULL,
  catalog_product_id uuid REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  score numeric,
  decision text NOT NULL,
  reason text,
  ai_confidence numeric,
  match_confidence numeric,
  verification_confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_match_history_draft_idx
  ON public.product_match_history (draft_id);

-- ---------------------------------------------------------------------------
-- Extend affiliate_links for catalog-scoped affiliate cache
-- ---------------------------------------------------------------------------
ALTER TABLE public.affiliate_links
  ALTER COLUMN context DROP NOT NULL,
  ALTER COLUMN context_id DROP NOT NULL;

ALTER TABLE public.affiliate_links
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS merchant_url text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified timestamptz;

CREATE INDEX IF NOT EXISTS affiliate_links_catalog_provider_idx
  ON public.affiliate_links (catalog_product_id, provider);

-- ---------------------------------------------------------------------------
-- ingest_draft_products: merchant vs affiliate separation + resolution
-- ---------------------------------------------------------------------------
ALTER TABLE public.ingest_draft_products
  ADD COLUMN IF NOT EXISTS merchant_url text,
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_status text
    CHECK (resolution_status IS NULL OR resolution_status IN ('VERIFIED', 'UNVERIFIED', 'UNRESOLVED')),
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS match_confidence numeric;

CREATE INDEX IF NOT EXISTS ingest_draft_products_catalog_idx
  ON public.ingest_draft_products (catalog_product_id);

-- ---------------------------------------------------------------------------
-- video_products: catalog link + separate URLs
-- ---------------------------------------------------------------------------
ALTER TABLE public.video_products
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merchant_url text,
  ADD COLUMN IF NOT EXISTS resolution_status text
    CHECK (resolution_status IS NULL OR resolution_status IN ('VERIFIED', 'UNVERIFIED', 'UNRESOLVED'));

-- video_products already has affiliate_url; merchant_url is new and separate.

CREATE INDEX IF NOT EXISTS video_products_catalog_idx
  ON public.video_products (catalog_product_id);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_search_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_search_debug ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_match_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.catalog_products IS
  'Global product catalog — source of truth for commerce; verification_status VERIFIED|UNVERIFIED|UNRESOLVED.';
COMMENT ON COLUMN public.catalog_products.canonical_slug IS
  'Permanent public product identifier (e.g. apple-macbook-air-m4).';
COMMENT ON COLUMN public.ingest_draft_products.merchant_url IS
  'Original merchant PDP URL; never store affiliate wrappers here.';
COMMENT ON COLUMN public.ingest_draft_products.affiliate_url IS
  'Affiliate wrapper URL only (regenerable); not the merchant PDP.';
