-- Place Resolution V1, phase 2.
-- Extraction persists a specific mention before resolution runs, so the
-- unresolved reason includes pending_resolution. It is not a canonical place.

ALTER TABLE public.content_source_places
  DROP CONSTRAINT IF EXISTS content_source_places_unresolved_reason_check;

ALTER TABLE public.content_source_places
  ADD CONSTRAINT content_source_places_unresolved_reason_check
  CHECK (
    unresolved_reason IS NULL
    OR unresolved_reason IN (
      'name_not_distinctive',
      'ambiguous',
      'no_results',
      'provider_failed',
      'locality_conflict',
      'category_conflict',
      'pending_resolution'
    )
  );
