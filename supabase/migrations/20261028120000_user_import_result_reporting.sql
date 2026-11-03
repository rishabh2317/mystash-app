-- Places milestone 1. Local preparation only; deploy before the matching API/worker.
-- Existing lifecycle/DTO fields and all product/creator/analytics tables stay intact.
BEGIN;

ALTER TABLE public.user_imports
  ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

COMMENT ON COLUMN public.user_imports.attempt_started_at IS
  'Explicit retry/re-share clock. Null uses original created_at for existing imports.';
COMMENT ON COLUMN public.user_imports.hidden_at IS
  'Activity history visibility only. Preserve place/cart source attribution and global work.';

CREATE TABLE public.content_source_import_progress (
  content_source_id uuid PRIMARY KEY REFERENCES public.content_sources(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  extraction_version text NOT NULL DEFAULT 'legacy',
  product_status text NOT NULL CHECK (product_status IN ('running','complete','failed')),
  place_status text NOT NULL CHECK (place_status IN ('running','complete','failed'))
);
ALTER TABLE public.content_source_import_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_source_import_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_source_import_progress TO service_role;
COMMENT ON TABLE public.content_source_import_progress IS
  'Latest user-import branch outcomes; no prompts or raw provider payloads. Counts come from persisted entities.';

COMMIT;
