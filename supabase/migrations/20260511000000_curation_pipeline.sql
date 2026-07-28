-- Curation pipeline: ingest → review → publish
-- Requires existing public.videos table (Expo app feed).

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS video_title text,
  ADD COLUMN IF NOT EXISTS curator_id text;

CREATE TABLE IF NOT EXISTS public.ingest_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source_url text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'draft',
  video_id uuid REFERENCES public.videos (id) ON DELETE SET NULL,
  stash_score numeric DEFAULT 4.5,
  video_title text,
  thumbnail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_requests_user_created_idx
  ON public.ingest_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ingest_requests_user_url_idx
  ON public.ingest_requests (user_id, source_url);

CREATE TABLE IF NOT EXISTS public.ingest_draft_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid NOT NULL REFERENCES public.ingest_requests (id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  price text NOT NULL,
  currency text,
  image text,
  affiliate_url text NOT NULL,
  provider text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingest_request_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.video_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos (id) ON DELETE CASCADE,
  name text NOT NULL,
  price text NOT NULL,
  image text NOT NULL DEFAULT '',
  affiliate_url text,
  provider text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_products_video_idx ON public.video_products (video_id);

CREATE TABLE IF NOT EXISTS public.ingest_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid NOT NULL REFERENCES public.ingest_requests (id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context text NOT NULL,
  context_id uuid NOT NULL,
  provider text NOT NULL,
  affiliate_url text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_request_id uuid REFERENCES public.ingest_requests (id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ingest_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_draft_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_products_select_public ON public.video_products;
CREATE POLICY video_products_select_public ON public.video_products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS ingest_requests_select_own ON public.ingest_requests;
CREATE POLICY ingest_requests_select_own ON public.ingest_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ingest_draft_products_select_via_ingest ON public.ingest_draft_products;
CREATE POLICY ingest_draft_products_select_via_ingest ON public.ingest_draft_products
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.ingest_requests ir
      WHERE ir.id = ingest_draft_products.ingest_request_id AND ir.user_id = auth.uid()
    )
  );

-- No direct client writes to pipeline tables (Edge Functions use service role)
