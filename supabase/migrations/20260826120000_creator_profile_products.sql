-- Support efficient creator product listing + published saves aggregate
CREATE INDEX IF NOT EXISTS collections_creator_published_saves_idx
  ON public.collections (creator_id)
  WHERE status = 'published' AND visibility = 'public' AND moderation_state = 'clear' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS collection_product_tags_catalog_lookup_idx
  ON public.collection_product_tags (collection_id, catalog_product_id)
  WHERE deleted_at IS NULL
    AND visibility = 'visible'
    AND COALESCE(include_in_publish, true) = true
    AND catalog_product_id IS NOT NULL;
