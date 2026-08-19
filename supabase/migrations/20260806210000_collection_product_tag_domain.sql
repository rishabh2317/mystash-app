-- CollectionProductTag V1 canonical fields
-- See backend/docs/COLLECTION_PRODUCT_TAG_DOMAIN_SPEC.md

ALTER TABLE public.collection_product_tags
  ADD COLUMN IF NOT EXISTS recommendation_strength text NOT NULL DEFAULT 'SECONDARY',
  ADD COLUMN IF NOT EXISTS selection_source text,
  ADD COLUMN IF NOT EXISTS tag_status text NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS creator_note text,
  ADD COLUMN IF NOT EXISTS creator_action text,
  ADD COLUMN IF NOT EXISTS detection_source text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_by text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_updated_at timestamptz;

-- Backfill strength + selection_source from legacy columns
UPDATE public.collection_product_tags
SET recommendation_strength = CASE WHEN is_primary THEN 'PRIMARY' ELSE 'SECONDARY' END
WHERE recommendation_strength IS NULL
   OR recommendation_strength = 'SECONDARY' AND is_primary = true
   OR recommendation_strength = 'PRIMARY' AND is_primary = false;

UPDATE public.collection_product_tags
SET recommendation_strength = CASE WHEN is_primary THEN 'PRIMARY' ELSE recommendation_strength END;

UPDATE public.collection_product_tags
SET selection_source = CASE tag_source
  WHEN 'manual' THEN 'CREATOR_MANUAL'
  WHEN 'import' THEN 'IMPORT'
  ELSE 'AI_DETECTED'
END
WHERE selection_source IS NULL;

UPDATE public.collection_product_tags
SET tag_status = 'accepted',
    accepted_at = COALESCE(accepted_at, created_at)
WHERE tag_status = 'proposed'
  AND tag_source IN ('manual', 'import', 'ai');

UPDATE public.collection_product_tags
SET snapshot_updated_at = COALESCE(snapshot_updated_at, updated_at, created_at)
WHERE snapshot_updated_at IS NULL
  AND (
    name_snapshot IS NOT NULL
    OR image_snapshot IS NOT NULL
    OR brand_snapshot IS NOT NULL
    OR category_snapshot IS NOT NULL
  );

ALTER TABLE public.collection_product_tags
  ALTER COLUMN selection_source SET DEFAULT 'AI_DETECTED';

UPDATE public.collection_product_tags
SET selection_source = 'AI_DETECTED'
WHERE selection_source IS NULL;

ALTER TABLE public.collection_product_tags
  ALTER COLUMN selection_source SET NOT NULL;

-- Drop and recreate CHECKs idempotently
ALTER TABLE public.collection_product_tags
  DROP CONSTRAINT IF EXISTS collection_product_tags_recommendation_strength_check;
ALTER TABLE public.collection_product_tags
  ADD CONSTRAINT collection_product_tags_recommendation_strength_check
  CHECK (recommendation_strength IN (
    'PRIMARY',
    'SECONDARY',
    'BEST_OVERALL',
    'RUNNER_UP',
    'BUDGET_PICK',
    'ALTERNATIVE',
    'AVOID'
  ));

ALTER TABLE public.collection_product_tags
  DROP CONSTRAINT IF EXISTS collection_product_tags_selection_source_check;
ALTER TABLE public.collection_product_tags
  ADD CONSTRAINT collection_product_tags_selection_source_check
  CHECK (selection_source IN (
    'AI_DETECTED',
    'AI_RECOMMENDED',
    'CREATOR_MANUAL',
    'CREATOR_ACCEPTED_AI',
    'IMPORT',
    'SYSTEM'
  ));

ALTER TABLE public.collection_product_tags
  DROP CONSTRAINT IF EXISTS collection_product_tags_tag_status_check;
ALTER TABLE public.collection_product_tags
  ADD CONSTRAINT collection_product_tags_tag_status_check
  CHECK (tag_status IN (
    'proposed',
    'accepted',
    'rejected',
    'published',
    'archived',
    'deleted'
  ));

ALTER TABLE public.collection_product_tags
  DROP CONSTRAINT IF EXISTS collection_product_tags_visibility_check;
ALTER TABLE public.collection_product_tags
  ADD CONSTRAINT collection_product_tags_visibility_check
  CHECK (visibility IN ('visible', 'hidden'));

-- One catalog product per Collection (active rows only)
DROP INDEX IF EXISTS collection_product_tags_collection_catalog_uidx;
CREATE UNIQUE INDEX collection_product_tags_collection_catalog_uidx
  ON public.collection_product_tags (collection_id, catalog_product_id)
  WHERE catalog_product_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS collection_product_tags_strength_idx
  ON public.collection_product_tags (collection_id)
  WHERE recommendation_strength = 'PRIMARY' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS collection_product_tags_status_idx
  ON public.collection_product_tags (collection_id, tag_status);

CREATE INDEX IF NOT EXISTS collection_product_tags_publish_surface_idx
  ON public.collection_product_tags (collection_id, include_in_publish, visibility)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.collection_product_tags.recommendation_strength IS
  'SoT for primacy; is_primary is synced denorm (PRIMARY => true)';
COMMENT ON COLUMN public.collection_product_tags.selection_source IS
  'Frozen enum; legacy tag_source remains for back-compat reads';
COMMENT ON COLUMN public.collection_product_tags.creator_note IS
  'Per-product creator guidance; not Collection caption';
