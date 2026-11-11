-- Supabase default grants can explicitly grant new functions to client roles.
-- Trigger execution does not require those clients to call the helper directly.
REVOKE ALL ON FUNCTION public.shopping_preserve_country_offer_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_preserve_country_offer_cache() TO service_role;
