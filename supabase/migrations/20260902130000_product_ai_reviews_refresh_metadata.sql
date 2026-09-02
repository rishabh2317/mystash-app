-- Stale READY refresh failure metadata (does not replace the cached review).
ALTER TABLE public.product_ai_reviews
  ADD COLUMN IF NOT EXISTS refresh_error_code text,
  ADD COLUMN IF NOT EXISTS refresh_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS product_ai_reviews_refresh_next_retry_idx
  ON public.product_ai_reviews (refresh_next_retry_at)
  WHERE refresh_next_retry_at IS NOT NULL;
