-- Cart domain V1: authenticated cart_items membership (no cart header table).
-- Spec: backend/docs/CART_DOMAIN_SPEC.md
-- Plan: backend/docs/CART_DOMAIN_IMPLEMENTATION_PLAN.md

CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products (id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source_collection_id uuid NULL,
  source_creator_id uuid NULL,
  source_collection_product_tag_id uuid NULL,
  source_surface text NULL
    CHECK (
      source_surface IS NULL
      OR source_surface IN ('COLLECTION', 'SEARCH', 'PRODUCT_DETAILS', 'OTHER')
    ),
  schema_version int NOT NULL DEFAULT 1,
  CONSTRAINT cart_items_user_product_unique UNIQUE (user_id, catalog_product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_added_idx
  ON public.cart_items (user_id, added_at DESC);

CREATE INDEX IF NOT EXISTS cart_items_catalog_product_idx
  ON public.cart_items (catalog_product_id);

COMMENT ON TABLE public.cart_items IS
  'Cart membership SoT — one active line per (user_id, catalog_product_id); Catalog remains Product SoT.';

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY cart_items_select_own ON public.cart_items
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY cart_items_insert_own ON public.cart_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY cart_items_delete_own ON public.cart_items
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updates used for Catalog merge remapping (service-role) and updated_at.
CREATE POLICY cart_items_update_own ON public.cart_items
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
