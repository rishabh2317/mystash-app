-- Multimodal progressive ingest pipeline (v5)
-- Pipeline runs, stage artifacts, frames, composite video cache, draft evidence columns.

ALTER TABLE public.ingest_draft_products
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS sources jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frame_refs jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.ingest_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid NOT NULL REFERENCES public.ingest_requests (id) ON DELETE CASCADE,
  cache_key text,
  stages_completed text[] NOT NULL DEFAULT '{}',
  final_stage text,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ready_for_review', 'review_required', 'failed', 'cached')),
  duration_ms integer,
  token_usage jsonb DEFAULT '{}'::jsonb,
  estimated_cost_usd numeric,
  model_used text,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_pipeline_runs_ingest_idx
  ON public.ingest_pipeline_runs (ingest_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ingest_stage_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid NOT NULL REFERENCES public.ingest_requests (id) ON DELETE CASCADE,
  pipeline_run_id uuid REFERENCES public.ingest_pipeline_runs (id) ON DELETE CASCADE,
  stage text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  duration_ms integer,
  token_usage jsonb DEFAULT '{}'::jsonb,
  cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_stage_artifacts_ingest_stage_idx
  ON public.ingest_stage_artifacts (ingest_request_id, stage);

CREATE TABLE IF NOT EXISTS public.ingest_frame_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid NOT NULL REFERENCES public.ingest_requests (id) ON DELETE CASCADE,
  pipeline_run_id uuid REFERENCES public.ingest_pipeline_runs (id) ON DELETE SET NULL,
  stage text NOT NULL,
  frame_index integer NOT NULL,
  timestamp_ms integer NOT NULL,
  storage_path text,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingest_request_id, stage, frame_index)
);

CREATE TABLE IF NOT EXISTS public.video_extraction_cache (
  cache_key text PRIMARY KEY,
  platform text NOT NULL,
  external_video_id text NOT NULL,
  pipeline_version text NOT NULL,
  provider_version text NOT NULL,
  payload jsonb NOT NULL,
  product_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_extraction_cache_video_idx
  ON public.video_extraction_cache (platform, external_video_id);

ALTER TABLE public.ingest_pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_stage_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_frame_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_extraction_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.video_extraction_cache IS
  'Composite key cache: platform:videoId:pipelineVersion:providerVersion — never rerun AI on hit.';

-- Terminal status when auto-extract finds no confident products (app shows manual CTA).
COMMENT ON COLUMN public.ingest_requests.status IS
  'draft|processing|ready_for_review|review_required|queued|failed|rejected';
