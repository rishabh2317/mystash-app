-- Content Source domain (Discover Anywhere, Phase 2): durable global identity of shared
-- content — "this URL/content has been or is being processed".
-- Capture + async handoff only: no extraction, no product identity, no Bag linkage.
-- Doc: docs/mystash-user-ingestion-phase-2-content-source.md

CREATE TABLE IF NOT EXISTS public.content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lowercase values match detectPlatform / video_extraction_cache.platform so the
  -- existing extraction cache key can be rebuilt from this row in Phase 3.
  platform text NOT NULL
    CHECK (platform IN ('youtube', 'instagram', 'web')),
  -- Video: platform video id (parseSupportedVideoUrl).
  -- Web page: canonical-URL identity (externalIdForProductUrl).
  external_id text NOT NULL,
  canonical_url text NOT NULL,
  media_kind text NOT NULL
    CHECK (media_kind IN ('VIDEO', 'WEB_PAGE')),
  -- Phase 2 writes RECEIVED and QUEUED only; Phase 3 owns the remaining transitions.
  processing_status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED')),
  pipeline_version text NOT NULL,
  queued_at timestamptz NULL,
  last_processed_at timestamptz NULL,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Global dedup invariant: one row per logical source, enforced by the database.
  CONSTRAINT content_sources_platform_external_unique UNIQUE (platform, external_id)
);

-- Recovery sweep support: find sources accepted but never queued / failed.
CREATE INDEX IF NOT EXISTS content_sources_status_created_idx
  ON public.content_sources (processing_status, created_at);

COMMENT ON TABLE public.content_sources IS
  'Content Source SoT — global identity of shared content, one row per (platform, external_id). User Import stays user-scoped; Catalog remains Product SoT.';
COMMENT ON COLUMN public.content_sources.external_id IS
  'Platform video id for VIDEO, canonical-URL identity for WEB_PAGE. Never user-scoped.';
COMMENT ON COLUMN public.content_sources.processing_status IS
  'RECEIVED (accepted, not queued) → QUEUED → PROCESSING → READY | FAILED. Phase 2 writes RECEIVED/QUEUED only; RECEIVED is the re-enqueue signal after an enqueue failure.';

ALTER TABLE public.content_sources ENABLE ROW LEVEL SECURITY;

-- No client policies: content sources are global and written only by the service-role
-- backend. Client reads stay mediated by user-scoped endpoints.

ALTER TABLE public.user_imports
  ADD COLUMN IF NOT EXISTS content_source_id uuid NULL
    REFERENCES public.content_sources (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS user_imports_content_source_idx
  ON public.user_imports (content_source_id);

COMMENT ON COLUMN public.user_imports.content_source_id IS
  'Global content identity for this submission. NULL only for pre-Phase-2 rows; new imports always set it.';
