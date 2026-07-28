-- Feed WebView + publish path expect `embed_url` on `videos` (see backend/src/publish.ts).
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS embed_url text;

COMMENT ON COLUMN public.videos.embed_url IS 'Canonical embed/watch URL for the player (YouTube embed, Instagram reel URL, etc.).';
