-- Place Resolution V1, phase 1.
-- Additive tables only. Local rows are disposable: this migration does not backfill
-- cart_items, discovered_products, or content_source_products.
-- Canonical places are created only after an accepted provider identity.
-- Unresolved leads live in content_source_places + user_place_saves with place_id null.

CREATE TABLE IF NOT EXISTS public.places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_place_id text NOT NULL,
  name text NOT NULL,
  locality text NULL,
  city text NULL,
  region text NULL,
  country text NULL,
  category text NULL,
  formatted_address text NULL,
  latitude double precision NULL,
  longitude double precision NULL,
  maps_url text NULL,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT places_provider_place_unique UNIQUE (provider, provider_place_id),
  CONSTRAINT places_provider_not_blank CHECK (char_length(btrim(provider)) > 0),
  CONSTRAINT places_provider_place_id_not_blank CHECK (char_length(btrim(provider_place_id)) > 0),
  CONSTRAINT places_name_not_blank CHECK (char_length(btrim(name)) > 0)
);

COMMENT ON TABLE public.places IS
  'Canonical real-world places, unique on provider place id. Never insert a row for an unresolved mention.';

CREATE TABLE IF NOT EXISTS public.content_source_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_source_id uuid NOT NULL REFERENCES public.content_sources (id) ON DELETE CASCADE,
  extracted_name text NOT NULL,
  category text NULL,
  locality text NULL,
  city text NULL,
  region text NULL,
  country text NULL,
  mentioned_address text NULL,
  confidence numeric NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_state text NOT NULL,
  unresolved_reason text NULL,
  place_id uuid NULL REFERENCES public.places (id) ON DELETE RESTRICT,
  hypothesis_key text NOT NULL,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_source_places_source_key_unique UNIQUE (content_source_id, hypothesis_key),
  CONSTRAINT content_source_places_name_not_blank CHECK (char_length(btrim(extracted_name)) > 0),
  CONSTRAINT content_source_places_resolution_state_check CHECK (
    resolution_state IN ('resolved', 'unresolved')
  ),
  CONSTRAINT content_source_places_unresolved_reason_check CHECK (
    unresolved_reason IS NULL
    OR unresolved_reason IN (
      'name_not_distinctive',
      'ambiguous',
      'no_results',
      'provider_failed',
      'locality_conflict',
      'category_conflict'
    )
  ),
  CONSTRAINT content_source_places_resolution_shape_check CHECK (
    (
      resolution_state = 'resolved'
      AND place_id IS NOT NULL
      AND unresolved_reason IS NULL
    )
    OR (
      resolution_state = 'unresolved'
      AND place_id IS NULL
      AND unresolved_reason IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS content_source_places_source_idx
  ON public.content_source_places (content_source_id, created_at);

COMMENT ON TABLE public.content_source_places IS
  'Extracted place hypothesis for a content source. place_id is set only when resolution_state is resolved.';
COMMENT ON COLUMN public.content_source_places.hypothesis_key IS
  'Normalized extracted name plus stated location fields. Reprocess updates this row instead of stacking a copy.';

CREATE TABLE IF NOT EXISTS public.user_place_saves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content_source_place_id uuid NOT NULL REFERENCES public.content_source_places (id) ON DELETE CASCADE,
  place_id uuid NULL REFERENCES public.places (id) ON DELETE RESTRICT,
  content_source_id uuid NOT NULL REFERENCES public.content_sources (id) ON DELETE CASCADE,
  user_import_id uuid NOT NULL REFERENCES public.user_imports (id) ON DELETE RESTRICT,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_place_saves_user_hypothesis_unique UNIQUE (user_id, content_source_place_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_place_saves_user_place_unique
  ON public.user_place_saves (user_id, place_id)
  WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_place_saves_user_created_idx
  ON public.user_place_saves (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_place_saves_user_import_idx
  ON public.user_place_saves (user_import_id);

COMMENT ON TABLE public.user_place_saves IS
  'User Stash card for a place. place_id is null for an unresolved lead and set only for a canonical place.';

ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_source_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_place_saves ENABLE ROW LEVEL SECURITY;

-- No client policies. Writes and reads go through the service-role backend.
-- A later GET /places mediates user_place_saves. Clients cannot insert a guessed place.
