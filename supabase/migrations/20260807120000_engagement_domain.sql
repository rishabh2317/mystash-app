-- Engagement domain V1: interaction facts, relationship edges, counter projections.
-- Spec: backend/docs/ENGAGEMENT_DOMAIN_SPEC.md (§16 frozen).
-- Analytics mirrors later; Collection/User counters remain denorm slots.

-- ---------------------------------------------------------------------------
-- engagement_interaction_facts (immutable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.engagement_interaction_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  interaction_type text NOT NULL,
  object_type text NOT NULL
    CHECK (object_type IN ('collection', 'creator', 'catalog_product', 'collection_product_tag', 'session', 'app')),
  object_id text NOT NULL,
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  anonymous_id text,
  privacy_class text NOT NULL DEFAULT 'private'
    CHECK (privacy_class IN ('public', 'private', 'anonymous')),
  collection_id uuid,
  collection_product_tag_id uuid,
  catalog_product_id uuid,
  creator_id uuid,
  session_id uuid,
  surface text,
  compensating_for_event_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_facts_event_id_unique UNIQUE (event_id),
  CONSTRAINT engagement_facts_actor_chk CHECK (
    actor_user_id IS NOT NULL OR anonymous_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS engagement_facts_actor_occurred_idx
  ON public.engagement_interaction_facts (actor_user_id, occurred_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS engagement_facts_object_occurred_idx
  ON public.engagement_interaction_facts (object_type, object_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS engagement_facts_type_occurred_idx
  ON public.engagement_interaction_facts (interaction_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS engagement_facts_tag_idx
  ON public.engagement_interaction_facts (collection_product_tag_id)
  WHERE collection_product_tag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS engagement_facts_catalog_idx
  ON public.engagement_interaction_facts (catalog_product_id)
  WHERE catalog_product_id IS NOT NULL;

COMMENT ON TABLE public.engagement_interaction_facts IS
  'Engagement SoT — immutable interaction facts; client event_id is idempotency key.';

-- ---------------------------------------------------------------------------
-- engagement_relationship_edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.engagement_relationship_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  edge_type text NOT NULL
    CHECK (edge_type IN ('FOLLOW', 'SAVE', 'HIDE', 'WISHLIST')),
  object_type text NOT NULL
    CHECK (object_type IN ('creator', 'collection', 'catalog_product')),
  object_id text NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE', 'REMOVED')),
  source_event_id uuid,
  privacy_class text NOT NULL DEFAULT 'private'
    CHECK (privacy_class IN ('public', 'private', 'anonymous')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One ACTIVE edge per user/type/object
CREATE UNIQUE INDEX IF NOT EXISTS engagement_edges_active_unique_idx
  ON public.engagement_relationship_edges (user_id, edge_type, object_type, object_id)
  WHERE state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS engagement_edges_object_idx
  ON public.engagement_relationship_edges (object_type, object_id, edge_type)
  WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS engagement_edges_user_type_idx
  ON public.engagement_relationship_edges (user_id, edge_type)
  WHERE state = 'ACTIVE';

COMMENT ON TABLE public.engagement_relationship_edges IS
  'Engagement relationship graph (FOLLOW/SAVE/HIDE/WISHLIST). No LIKE in V1.';

-- ---------------------------------------------------------------------------
-- engagement_counter_projections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.engagement_counter_projections (
  object_type text NOT NULL
    CHECK (object_type IN ('collection', 'creator', 'user', 'catalog_product', 'collection_product_tag')),
  object_id text NOT NULL,
  counter_name text NOT NULL,
  value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type, object_id, counter_name)
);

CREATE INDEX IF NOT EXISTS engagement_counters_updated_idx
  ON public.engagement_counter_projections (updated_at DESC);

COMMENT ON TABLE public.engagement_counter_projections IS
  'Canonical engagement counters; Collection/User denorm fields are async mirrors.';

ALTER TABLE public.engagement_interaction_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_relationship_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_counter_projections ENABLE ROW LEVEL SECURITY;
