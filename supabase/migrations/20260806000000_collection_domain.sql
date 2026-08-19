-- Collection domain: primary business object (recommendation package).
-- Dual-writes to videos/video_products on publish; Collection is SoT.

CREATE TABLE IF NOT EXISTS public.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  creator_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'processing',
      'ready_for_review',
      'review_required',
      'rejected',
      'published',
      'unpublished',
      'archived',
      'deleted'
    )),
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'unlisted', 'private')),
  published_at timestamptz,
  unpublished_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  content_revision int NOT NULL DEFAULT 0,

  title text,
  caption text,
  language text,
  primary_locale text,

  recommendation_intent text,
  recommendation_intents_secondary text[] DEFAULT '{}',
  recommendation_intent_source text
    CHECK (recommendation_intent_source IS NULL OR recommendation_intent_source IN (
      'ai', 'creator', 'hybrid', 'system'
    )),
  recommendation_intent_confidence numeric,

  creator_name text,
  creator_username text,
  creator_avatar text,
  creator_verified boolean NOT NULL DEFAULT false,
  creator_snapshot_updated_at timestamptz,

  primary_media_id uuid,
  media_count int NOT NULL DEFAULT 0,
  hero_thumbnail_url text,

  primary_product_tag_id uuid,
  product_tag_count int NOT NULL DEFAULT 0,
  primary_product_name_snapshot text,

  search_title text,
  search_text text,
  search_keywords text[] DEFAULT '{}',
  search_brands text[] DEFAULT '{}',
  search_categories text[] DEFAULT '{}',
  search_source_updated_at timestamptz,

  views_count int NOT NULL DEFAULT 0,
  likes_count int NOT NULL DEFAULT 0,
  saves_count int NOT NULL DEFAULT 0,
  shares_count int NOT NULL DEFAULT 0,
  product_clicks_count int NOT NULL DEFAULT 0,
  purchases_count int NOT NULL DEFAULT 0,
  counters_updated_at timestamptz,

  quality_score numeric,
  commerce_score numeric,
  search_score numeric,
  recommendation_score numeric,
  trust_score numeric,
  quality_signals_updated_at timestamptz,

  feed_eligible boolean NOT NULL DEFAULT false,
  search_eligible boolean NOT NULL DEFAULT false,
  recs_eligible boolean NOT NULL DEFAULT false,

  moderation_state text NOT NULL DEFAULT 'clear'
    CHECK (moderation_state IN ('clear', 'needs_review', 'rejected', 'takedown')),
  moderation_notes_ref uuid,

  origin_type text NOT NULL DEFAULT 'url_ingest'
    CHECK (origin_type IN (
      'url_ingest',
      'manual_curation',
      'native_upload',
      'import_instagram',
      'import_pinterest',
      'ai_generated'
    )),
  origin_platform text,
  origin_source_url text,
  latest_ingest_run_id uuid,
  schema_version int NOT NULL DEFAULT 1,
  extensions jsonb DEFAULT '{}'::jsonb,

  CONSTRAINT collections_slug_unique UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS public.collection_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.collections (id) ON DELETE CASCADE,
  media_type text NOT NULL DEFAULT 'video_external'
    CHECK (media_type IN (
      'video_external',
      'video_native',
      'image',
      'pdf',
      'link'
    )),
  source_url text,
  embed_url text,
  thumbnail_url text,
  duration_ms int,
  aspect_ratio text,
  sort_order int NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'ready'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collection_product_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.collections (id) ON DELETE CASCADE,
  catalog_product_id uuid REFERENCES public.catalog_products (id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  tag_source text NOT NULL DEFAULT 'ai'
    CHECK (tag_source IN ('ai', 'manual', 'import')),
  confidence numeric,
  frame_cues jsonb DEFAULT '[]'::jsonb,
  include_in_publish boolean NOT NULL DEFAULT true,
  name_snapshot text,
  image_snapshot text,
  brand_snapshot text,
  category_snapshot text,
  resolution_status text
    CHECK (resolution_status IS NULL OR resolution_status IN (
      'VERIFIED', 'UNVERIFIED', 'UNRESOLVED'
    )),
  external_id text,
  merchant_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- FK from collections to media/tags (deferred until child tables exist)
ALTER TABLE public.collections
  DROP CONSTRAINT IF EXISTS collections_primary_media_id_fkey;
ALTER TABLE public.collections
  ADD CONSTRAINT collections_primary_media_id_fkey
  FOREIGN KEY (primary_media_id) REFERENCES public.collection_media (id) ON DELETE SET NULL;

ALTER TABLE public.collections
  DROP CONSTRAINT IF EXISTS collections_primary_product_tag_id_fkey;
ALTER TABLE public.collections
  ADD CONSTRAINT collections_primary_product_tag_id_fkey
  FOREIGN KEY (primary_product_tag_id) REFERENCES public.collection_product_tags (id) ON DELETE SET NULL;

ALTER TABLE public.ingest_requests
  ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES public.collections (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS collections_creator_created_idx
  ON public.collections (creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS collections_status_visibility_idx
  ON public.collections (status, visibility)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS collections_feed_eligible_idx
  ON public.collections (created_at DESC)
  WHERE feed_eligible = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS collection_media_collection_sort_idx
  ON public.collection_media (collection_id, sort_order);

CREATE INDEX IF NOT EXISTS collection_product_tags_collection_sort_idx
  ON public.collection_product_tags (collection_id, sort_order);

CREATE INDEX IF NOT EXISTS collection_product_tags_catalog_idx
  ON public.collection_product_tags (catalog_product_id)
  WHERE catalog_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ingest_requests_collection_id_idx
  ON public.ingest_requests (collection_id)
  WHERE collection_id IS NOT NULL;

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_product_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collections_select_public ON public.collections;
CREATE POLICY collections_select_public ON public.collections
  FOR SELECT USING (
    status = 'published'
    AND visibility = 'public'
    AND deleted_at IS NULL
    AND moderation_state = 'clear'
  );

DROP POLICY IF EXISTS collections_select_own ON public.collections;
CREATE POLICY collections_select_own ON public.collections
  FOR SELECT TO authenticated USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS collection_media_select_public ON public.collection_media;
CREATE POLICY collection_media_select_public ON public.collection_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_media.collection_id
        AND c.status = 'published'
        AND c.visibility = 'public'
        AND c.deleted_at IS NULL
        AND c.moderation_state = 'clear'
    )
  );

DROP POLICY IF EXISTS collection_media_select_own ON public.collection_media;
CREATE POLICY collection_media_select_own ON public.collection_media
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_media.collection_id AND c.creator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS collection_product_tags_select_public ON public.collection_product_tags;
CREATE POLICY collection_product_tags_select_public ON public.collection_product_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_product_tags.collection_id
        AND c.status = 'published'
        AND c.visibility = 'public'
        AND c.deleted_at IS NULL
        AND c.moderation_state = 'clear'
    )
  );

DROP POLICY IF EXISTS collection_product_tags_select_own ON public.collection_product_tags;
CREATE POLICY collection_product_tags_select_own ON public.collection_product_tags
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_product_tags.collection_id AND c.creator_id = auth.uid()
    )
  );
