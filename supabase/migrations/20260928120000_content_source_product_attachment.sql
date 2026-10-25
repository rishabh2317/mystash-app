-- Phase 4: provenance for creator-attached products on a content source.
-- Does not add a creator-scoped product table. Product identity stays catalog/discovered.

ALTER TABLE public.content_source_products
  ADD COLUMN IF NOT EXISTS attachment_source text;

ALTER TABLE public.content_source_products
  DROP CONSTRAINT IF EXISTS content_source_products_attachment_source_check;

ALTER TABLE public.content_source_products
  ADD CONSTRAINT content_source_products_attachment_source_check
  CHECK (
    attachment_source IS NULL
    OR attachment_source IN (
      'AI_DETECTED',
      'AI_RECOMMENDED',
      'CREATOR_MANUAL',
      'CREATOR_ACCEPTED_AI',
      'IMPORT',
      'SYSTEM'
    )
  );

COMMENT ON COLUMN public.content_source_products.attachment_source IS
  'How the product was attached to this content source. Null for extract rows. Not product identity.';
