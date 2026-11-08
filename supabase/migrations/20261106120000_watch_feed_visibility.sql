-- Authorize feed rows at read time as well as at projection-write time.
-- This also protects against an interrupted projection prune after unpublish.
DROP POLICY IF EXISTS videos_select_public ON public.videos;
CREATE POLICY videos_select_public ON public.videos
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = videos.collection_id
      AND c.status = 'published'
      AND c.visibility = 'public'
      AND c.moderation_state = 'clear'
      AND c.deleted_at IS NULL
      AND c.feed_eligible = true
  ));

CREATE INDEX IF NOT EXISTS videos_watch_feed_order_idx
  ON public.videos (created_at DESC, id DESC);
