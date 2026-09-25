-- Durable per-user-import timeout. Global content_sources may keep processing;
-- timed_out_at freezes this import's user-facing state at couldnt_finish.
ALTER TABLE public.user_imports
  ADD COLUMN IF NOT EXISTS timed_out_at timestamptz NULL;

COMMENT ON COLUMN public.user_imports.timed_out_at IS
  'When set, GET /imports always reports couldnt_finish for this row even if the content source later becomes READY. Does not cancel global content_source processing.';
