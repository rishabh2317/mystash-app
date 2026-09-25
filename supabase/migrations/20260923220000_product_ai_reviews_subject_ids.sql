-- Allow AI Review cache rows for catalogue OR discovered product UUIDs.
-- App code validates the subject exists; generation still uses ProductIdentityContext.
ALTER TABLE public.product_ai_reviews
  DROP CONSTRAINT IF EXISTS product_ai_reviews_product_id_fkey;

COMMENT ON TABLE public.product_ai_reviews IS
  'Cached AI Review summaries per catalogue or discovered product UUID. Refreshed at most once per 90-day evidence window.';
