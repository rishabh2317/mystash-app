-- Catalog as single source of truth for UI reads.
-- Clients may SELECT ACTIVE catalog rows; writes remain service-role only.

DROP POLICY IF EXISTS catalog_products_public_read ON public.catalog_products;

CREATE POLICY catalog_products_public_read
  ON public.catalog_products
  FOR SELECT
  TO anon, authenticated
  USING (status = 'ACTIVE');

COMMENT ON POLICY catalog_products_public_read ON public.catalog_products IS
  'UI surfaces read product metadata exclusively from catalog_products; external providers are ingest-only.';
