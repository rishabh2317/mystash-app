-- Backend-owned shopping destination resolution and click analytics.
-- Verification, shopping, and affiliate URLs deliberately remain separate.

ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS preferred_shopping_url text,
  ADD COLUMN IF NOT EXISTS shopping_provider text,
  ADD COLUMN IF NOT EXISTS verification_provider text;

UPDATE public.catalog_products
SET
  preferred_shopping_url = COALESCE(preferred_shopping_url, merchant_url),
  shopping_provider = COALESCE(shopping_provider, CASE WHEN merchant_url IS NOT NULL THEN 'merchant' END),
  verification_provider = COALESCE(verification_provider, verification_source)
WHERE
  preferred_shopping_url IS NULL
  OR shopping_provider IS NULL
  OR verification_provider IS NULL;

COMMENT ON COLUMN public.catalog_products.merchant_url IS
  'Canonical verified merchant PDP used for verification and enrichment; never an affiliate URL.';
COMMENT ON COLUMN public.catalog_products.preferred_shopping_url IS
  'Plain preferred shopping destination selected after verification; never an affiliate wrapper.';
COMMENT ON COLUMN public.catalog_products.affiliate_url IS
  'Fully resolved affiliate destination only; nullable and ignored while affiliate support is disabled.';
COMMENT ON COLUMN public.catalog_products.shopping_provider IS
  'Provider that owns the preferred shopping destination, independent of verification and affiliate providers.';
COMMENT ON COLUMN public.catalog_products.verification_provider IS
  'Provider that verified the canonical merchant product data.';

CREATE TABLE IF NOT EXISTS public.product_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products (id) ON DELETE CASCADE,
  video_id uuid REFERENCES public.videos (id) ON DELETE SET NULL,
  creator_id text,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  destination_url text NOT NULL,
  destination_type text NOT NULL
    CHECK (destination_type IN ('affiliate', 'preferred', 'merchant')),
  shopping_provider text,
  affiliate_provider text,
  platform text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_clicks_catalog_created_idx
  ON public.product_clicks (catalog_product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_clicks_video_created_idx
  ON public.product_clicks (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_clicks_creator_created_idx
  ON public.product_clicks (creator_id, created_at DESC);

ALTER TABLE public.product_clicks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.product_clicks IS
  'Server-written shopping redirect analytics captured before the outbound 302 response.';
