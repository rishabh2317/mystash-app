-- App feed reads `videos` with the anon key. Without a SELECT policy, RLS returns zero rows
-- while the dashboard (service role / SQL editor) still shows inserted rows.
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS videos_select_public ON public.videos;
CREATE POLICY videos_select_public ON public.videos
  FOR SELECT
  USING (true);

COMMENT ON POLICY videos_select_public ON public.videos IS 'Public read for home feed; writes use service role (publish) or bypass.';
