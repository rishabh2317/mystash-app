-- Explicit Video → Collection FK. Video and Collection have independent IDs.
-- Replaces the prior convention where videos.id === collections.id.
--
-- Invariant: every Home Feed video produced by publish belongs to exactly one Collection.
-- Collection hard-delete cascades to its feed video (video_products cascade from videos).

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS collection_id uuid;

ALTER TABLE public.videos
  DROP CONSTRAINT IF EXISTS videos_collection_id_fkey;

ALTER TABLE public.videos
  ADD CONSTRAINT videos_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES public.collections (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS videos_collection_id_unique_idx
  ON public.videos (collection_id);

ALTER TABLE public.videos
  ALTER COLUMN collection_id SET NOT NULL;

COMMENT ON COLUMN public.videos.collection_id IS
  'Required FK to the Collection this feed video belongs to. Independent from videos.id.';
