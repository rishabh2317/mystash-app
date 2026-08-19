-- Preserve normalized YouTube metadata so retries and later stages do not
-- need to discard or refetch context gathered before Stage 1 reasoning.
ALTER TABLE public.ingest_requests
  ADD COLUMN IF NOT EXISTS video_description text,
  ADD COLUMN IF NOT EXISTS video_description_source text,
  ADD COLUMN IF NOT EXISTS video_creator text;

COMMENT ON COLUMN public.ingest_requests.video_description IS
  'Normalized YouTube description fetched from Innertube metadata.';
COMMENT ON COLUMN public.ingest_requests.video_description_source IS
  'Provider field used for video_description (for example innertube_video_details).';
COMMENT ON COLUMN public.ingest_requests.video_creator IS
  'Normalized video creator/channel name.';
