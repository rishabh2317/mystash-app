-- Global cache for product link previews (normalized URL → fields). Backend service_role bypasses RLS.
CREATE TABLE IF NOT EXISTS public.canonical_products (
  canonical_url text PRIMARY KEY,
  name text NOT NULL,
  price text NOT NULL,
  currency text,
  image text,
  last_extracted_at timestamptz NOT NULL DEFAULT now(),
  extraction_source text NOT NULL DEFAULT 'scrape' CHECK (extraction_source IN ('scrape', 'ai'))
);

CREATE INDEX IF NOT EXISTS canonical_products_last_extracted_idx
  ON public.canonical_products (last_extracted_at DESC);

ALTER TABLE public.canonical_products ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.canonical_products IS 'Deduplicated product page previews keyed by canonical (tracking-stripped) URL.';
