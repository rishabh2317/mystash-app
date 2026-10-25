-- Phase 5: a Collection tag may point at an existing discovered product
-- without copying it into catalog_products. Publish still requires a catalog id.

ALTER TABLE public.collection_product_tags
  ADD COLUMN IF NOT EXISTS discovered_product_id uuid NULL
    REFERENCES public.discovered_products (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS collection_product_tags_collection_discovered_uidx
  ON public.collection_product_tags (collection_id, discovered_product_id)
  WHERE discovered_product_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.collection_product_tags.discovered_product_id IS
  'Existing discovered product identity copied from a content source. Not a second product.';
