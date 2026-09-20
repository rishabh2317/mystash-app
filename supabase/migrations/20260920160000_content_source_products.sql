-- Content Source products (Discover Anywhere, Phase 3): durable product candidates
-- belonging to a global content_source — never to a user_import.
-- Doc: docs/mystash-user-ingestion-phase-3-content-processing.md

ALTER TABLE public.content_sources
  ADD COLUMN IF NOT EXISTS candidate_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason text NULL;

COMMENT ON COLUMN public.content_sources.candidate_count IS
  'Number of product candidates last persisted for this source. READY + 0 = processed with no product.';
COMMENT ON COLUMN public.content_sources.failure_reason IS
  'Set on FAILED; cleared on a successful READY transition. Never a user-facing payload.';

CREATE TABLE IF NOT EXISTS public.content_source_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_source_id uuid NOT NULL REFERENCES public.content_sources (id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  -- Dedup key within a source; reused on idempotent re-runs (upsert).
  external_id text NOT NULL,
  name text NOT NULL,
  brand text,
  model text,
  category text,
  price text,
  currency text,
  image text,
  merchant_url text,
  confidence numeric,
  -- How this row was produced: ai_extract | cache | merchant_enrichment
  extraction_method text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  processor_version text NOT NULL,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_source_products_source_external_unique UNIQUE (content_source_id, external_id)
);

CREATE INDEX IF NOT EXISTS content_source_products_source_position_idx
  ON public.content_source_products (content_source_id, position);

COMMENT ON TABLE public.content_source_products IS
  'Global product candidates for a content_source. Not Catalog, not discovered_products, not Bag. User imports share these rows through content_source_id.';

ALTER TABLE public.content_source_products ENABLE ROW LEVEL SECURITY;
