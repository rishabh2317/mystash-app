-- Reel likes: appreciation belongs to videos.id, never collections.id.

ALTER TABLE public.engagement_interaction_facts
  DROP CONSTRAINT IF EXISTS engagement_interaction_facts_object_type_check;
ALTER TABLE public.engagement_interaction_facts
  ADD CONSTRAINT engagement_interaction_facts_object_type_check
  CHECK (
    object_type IN (
      'collection',
      'creator',
      'reel',
      'catalog_product',
      'collection_product_tag',
      'session',
      'app',
      'user'
    )
  );

ALTER TABLE public.engagement_relationship_edges
  DROP CONSTRAINT IF EXISTS engagement_relationship_edges_edge_type_check;
ALTER TABLE public.engagement_relationship_edges
  ADD CONSTRAINT engagement_relationship_edges_edge_type_check
  CHECK (edge_type IN ('FOLLOW', 'SAVE', 'LIKE', 'HIDE', 'WISHLIST'));

ALTER TABLE public.engagement_relationship_edges
  DROP CONSTRAINT IF EXISTS engagement_relationship_edges_object_type_check;
ALTER TABLE public.engagement_relationship_edges
  ADD CONSTRAINT engagement_relationship_edges_object_type_check
  CHECK (object_type IN ('creator', 'collection', 'reel', 'catalog_product'));

ALTER TABLE public.engagement_counter_projections
  DROP CONSTRAINT IF EXISTS engagement_counter_projections_object_type_check;
ALTER TABLE public.engagement_counter_projections
  ADD CONSTRAINT engagement_counter_projections_object_type_check
  CHECK (
    object_type IN (
      'collection',
      'creator',
      'user',
      'reel',
      'catalog_product',
      'collection_product_tag'
    )
  );

COMMENT ON TABLE public.engagement_relationship_edges IS
  'Engagement relationship graph. LIKE targets reel (videos.id); SAVE targets collection.';

CREATE OR REPLACE FUNCTION public.sum_creator_public_reel_likes(p_creator_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.engagement_relationship_edges e
  JOIN public.videos reel
    ON reel.id::text = e.object_id
  JOIN public.collections collection
    ON collection.id = reel.collection_id
  WHERE e.edge_type = 'LIKE'
    AND e.object_type = 'reel'
    AND e.state = 'ACTIVE'
    AND collection.creator_id = p_creator_id
    AND collection.status = 'published'
    AND collection.visibility = 'public'
    AND collection.moderation_state = 'clear'
    AND collection.deleted_at IS NULL
    AND collection.published_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public.sum_creator_public_reel_likes(uuid) IS
  'Current active likes received across a creator''s eligible/public Reel projections.';
