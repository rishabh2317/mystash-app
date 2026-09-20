-- Discover Anywhere Phase 4: discovered_products, candidate resolution binds,
-- and polymorphic Bag membership. Additive only.
-- Doc: docs/mystash-user-ingestion-phase-4-resolution.md

CREATE TABLE IF NOT EXISTS public.discovered_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable reuse key: merchant-URL identity (m_…) or name+brand+model (n_…).
  identity_key text NOT NULL,
  name text NOT NULL,
  brand text,
  model text,
  category text,
  image_url text,
  price text,
  currency text,
  merchant text,
  merchant_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_confidence numeric,
  completeness numeric,
  -- Internal only. Never a user-facing verification badge.
  internal_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (internal_status IN ('ACTIVE', 'HIDDEN')),
  -- Set only on a later explicit promotion. Phase 4 never writes this.
  catalog_product_id uuid NULL REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  processor_version text,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovered_products_identity_unique UNIQUE (identity_key)
);

CREATE INDEX IF NOT EXISTS discovered_products_merchant_url_idx
  ON public.discovered_products (merchant_url);

COMMENT ON TABLE public.discovered_products IS
  'Non-catalogue products extracted from user content. Not catalog_products. Not Bag.';

ALTER TABLE public.discovered_products ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- content_source_products: bind to exactly one of catalog OR discovered
-- ---------------------------------------------------------------------------
ALTER TABLE public.content_source_products
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid NULL
    REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discovered_product_id uuid NULL
    REFERENCES public.discovered_products (id) ON DELETE SET NULL;

ALTER TABLE public.content_source_products
  DROP CONSTRAINT IF EXISTS content_source_products_resolution_xor;

ALTER TABLE public.content_source_products
  ADD CONSTRAINT content_source_products_resolution_xor CHECK (
    (catalog_product_id IS NULL AND discovered_product_id IS NULL)
    OR (catalog_product_id IS NOT NULL AND discovered_product_id IS NULL)
    OR (catalog_product_id IS NULL AND discovered_product_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- cart_items: polymorphic membership + source attribution
-- ---------------------------------------------------------------------------
ALTER TABLE public.cart_items
  ALTER COLUMN catalog_product_id DROP NOT NULL;

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS discovered_product_id uuid NULL
    REFERENCES public.discovered_products (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_content_source_id uuid NULL
    REFERENCES public.content_sources (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_user_import_id uuid NULL
    REFERENCES public.user_imports (id) ON DELETE SET NULL;

ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_product_xor;

ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_product_xor CHECK (
    (catalog_product_id IS NOT NULL AND discovered_product_id IS NULL)
    OR (catalog_product_id IS NULL AND discovered_product_id IS NOT NULL)
  );

ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_user_product_unique;

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_catalog_unique
  ON public.cart_items (user_id, catalog_product_id)
  WHERE catalog_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_discovered_unique
  ON public.cart_items (user_id, discovered_product_id)
  WHERE discovered_product_id IS NOT NULL;

ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_source_surface_check;

ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_source_surface_check CHECK (
    source_surface IS NULL
    OR source_surface IN (
      'COLLECTION',
      'SEARCH',
      'PRODUCT_DETAILS',
      'OTHER',
      'USER_IMPORT'
    )
  );

CREATE INDEX IF NOT EXISTS cart_items_discovered_product_idx
  ON public.cart_items (discovered_product_id)
  WHERE discovered_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cart_items_source_content_idx
  ON public.cart_items (source_content_source_id)
  WHERE source_content_source_id IS NOT NULL;
