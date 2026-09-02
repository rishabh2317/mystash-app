-- Persistent product-level AI Review cache (Gemini + Google Search grounding).
CREATE TABLE IF NOT EXISTS public.product_ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.catalog_products (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('READY', 'GENERATING', 'UNAVAILABLE', 'FAILED')),
  summary text,
  pros jsonb NOT NULL DEFAULT '[]'::jsonb,
  cons jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_last_checked_at timestamptz,
  summary_generated_at timestamptz,
  evidence_hash text,
  model text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_ai_reviews_status_idx
  ON public.product_ai_reviews (status);

CREATE INDEX IF NOT EXISTS product_ai_reviews_evidence_checked_idx
  ON public.product_ai_reviews (evidence_last_checked_at);

COMMENT ON TABLE public.product_ai_reviews IS
  'Cached AI Review summaries per catalog product. Refreshed at most once per 90-day evidence window.';
