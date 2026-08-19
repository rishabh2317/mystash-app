-- Invalidate canonical preview rows created before native-currency validation.
ALTER TABLE public.canonical_products
  DROP CONSTRAINT IF EXISTS canonical_products_extraction_source_check;

ALTER TABLE public.canonical_products
  ADD CONSTRAINT canonical_products_extraction_source_check
  CHECK (
    extraction_source IN (
      'scrape',
      'ai',
      'scrape_currency_v2',
      'ai_currency_v2'
    )
  );

COMMENT ON COLUMN public.canonical_products.extraction_source IS
  'Extraction path and version; currency_v2 entries preserve explicit merchant currency.';
