-- CollectionMedia: external reference + processing metadata (no hosting).
-- Domain field processingStatus maps to processing_status column.

ALTER TABLE public.collection_media
  ADD COLUMN IF NOT EXISTS source_provider text,
  ADD COLUMN IF NOT EXISTS media_kind text NOT NULL DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS provider_creator_id text,
  ADD COLUMN IF NOT EXISTS provider_creator_name text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_availability text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS media_understanding_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS latest_processing_job_id uuid,
  ADD COLUMN IF NOT EXISTS latest_artifact_bundle_ref text,
  ADD COLUMN IF NOT EXISTS provider_metadata_version text,
  ADD COLUMN IF NOT EXISTS last_metadata_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_processing_error_code text,
  ADD COLUMN IF NOT EXISTS processing_attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schema_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS extensions jsonb DEFAULT '{}'::jsonb;

-- Align processing_status with new lifecycle vocabulary.
-- Legacy rows used pending|processing|ready|failed; map pending → imported.
UPDATE public.collection_media
SET processing_status = 'imported'
WHERE processing_status = 'pending';

UPDATE public.collection_media
SET processing_status = 'ready'
WHERE processing_status IS NULL OR processing_status NOT IN (
  'imported', 'processing', 'ready', 'failed', 'archived'
);

UPDATE public.collection_media
SET is_primary = true
WHERE is_primary IS DISTINCT FROM true;

UPDATE public.collection_media
SET media_kind = CASE
  WHEN media_type IN ('image') THEN 'image'
  WHEN media_type IN ('link', 'pdf') THEN 'link'
  ELSE 'video'
END
WHERE media_kind IS NULL OR media_kind = 'video';

UPDATE public.collection_media
SET source_provider = CASE
  WHEN source_url ILIKE '%youtube.com%' OR source_url ILIKE '%youtu.be%' THEN 'youtube'
  WHEN source_url ILIKE '%instagram.com%' THEN 'instagram'
  WHEN source_url ILIKE '%tiktok.com%' THEN 'tiktok'
  WHEN source_url ILIKE '%pinterest.%' THEN 'pinterest'
  ELSE source_provider
END
WHERE source_provider IS NULL AND source_url IS NOT NULL;

UPDATE public.collection_media
SET canonical_url = COALESCE(canonical_url, source_url)
WHERE canonical_url IS NULL;

-- Drop old check if present and add new constraints (Postgres: drop then add).
ALTER TABLE public.collection_media
  DROP CONSTRAINT IF EXISTS collection_media_processing_status_check;

ALTER TABLE public.collection_media
  ADD CONSTRAINT collection_media_processing_status_check
  CHECK (processing_status IN ('imported', 'processing', 'ready', 'failed', 'archived'));

ALTER TABLE public.collection_media
  DROP CONSTRAINT IF EXISTS collection_media_source_availability_check;

ALTER TABLE public.collection_media
  ADD CONSTRAINT collection_media_source_availability_check
  CHECK (source_availability IN ('unknown', 'available', 'unavailable', 'restricted'));

ALTER TABLE public.collection_media
  DROP CONSTRAINT IF EXISTS collection_media_transcript_status_check;

ALTER TABLE public.collection_media
  ADD CONSTRAINT collection_media_transcript_status_check
  CHECK (transcript_status IN (
    'not_started', 'running', 'succeeded', 'failed', 'skipped', 'unavailable'
  ));

ALTER TABLE public.collection_media
  DROP CONSTRAINT IF EXISTS collection_media_mu_status_check;

ALTER TABLE public.collection_media
  ADD CONSTRAINT collection_media_mu_status_check
  CHECK (media_understanding_status IN (
    'not_started', 'running', 'succeeded', 'failed', 'skipped', 'unavailable'
  ));

ALTER TABLE public.collection_media
  DROP CONSTRAINT IF EXISTS collection_media_media_kind_check;

ALTER TABLE public.collection_media
  ADD CONSTRAINT collection_media_media_kind_check
  CHECK (media_kind IN ('video', 'image', 'link'));

CREATE UNIQUE INDEX IF NOT EXISTS collection_media_one_primary_per_collection_idx
  ON public.collection_media (collection_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS collection_media_provider_external_idx
  ON public.collection_media (source_provider, external_id)
  WHERE source_provider IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS collection_media_processing_status_updated_idx
  ON public.collection_media (processing_status, updated_at);
