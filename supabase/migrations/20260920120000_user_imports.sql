-- User Import domain (Discover Anywhere, Phase 1): "this user shared this URL".
-- Capture/acceptance only — no processing, no product identity, no Bag linkage.
-- Doc: docs/mystash-user-ingestion-phase-1-share-capture.md

CREATE TABLE IF NOT EXISTS public.user_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Original shared payload (raw URL, or the text the URL arrived inside).
  raw_input text NOT NULL,
  -- URL extracted from raw_input.
  source_url text NOT NULL,
  -- Tracking-stripped / canonical form (reuses ingest URL canonicalization).
  normalized_url text NOT NULL,
  -- sha256(normalized_url); bounded key for the per-user uniqueness constraint.
  dedupe_key text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  -- Phase 1 terminal state. Processing states are added when Phase 2 lands.
  status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED')),
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_imports_user_dedupe_unique UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS user_imports_user_created_idx
  ON public.user_imports (user_id, created_at DESC);

COMMENT ON TABLE public.user_imports IS
  'User Import submission SoT — one row per (user_id, dedupe_key); Catalog remains Product SoT and Cart remains Bag membership SoT.';
COMMENT ON COLUMN public.user_imports.raw_input IS
  'Verbatim shared text; never parsed for products in Phase 1.';
COMMENT ON COLUMN public.user_imports.dedupe_key IS
  'sha256 of normalized_url — idempotency key for repeated shares by the same user.';

ALTER TABLE public.user_imports ENABLE ROW LEVEL SECURITY;

-- Owners may read their own submissions. Writes go through the backend
-- service-role API only (no direct client inserts), matching the pipeline tables.
CREATE POLICY user_imports_select_own ON public.user_imports
  FOR SELECT
  USING (auth.uid() = user_id);
