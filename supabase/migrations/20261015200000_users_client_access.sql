-- Phase 1 auth remediation: clients must not read private user rows or write
-- privileged columns on public.users. Profile and creator lifecycle writes stay
-- on the Node User API (service_role). Do not rewrite 20260806200000.

-- Approved public profile columns (no email, account_status, auth_provider, locale, counters internals).
CREATE OR REPLACE VIEW public.user_public_profiles AS
SELECT
  id,
  username,
  display_name,
  profile_photo_url,
  bio,
  website_url,
  social_links,
  creator_status,
  account_type,
  joined_at,
  followers_count,
  following_count,
  collection_count
FROM public.users
WHERE deleted_at IS NULL
  AND account_status IN ('CREATED', 'ACTIVE');

COMMENT ON VIEW public.user_public_profiles IS
  'Public profile projection of public.users. Owner-defined view (not security_invoker) so callers cannot SELECT private columns on the base table. Matches GET /users/by-username field set minus computed isCreator and live publicStats.';

-- Full-row public SELECT leaked email_mirrored and account metadata.
DROP POLICY IF EXISTS users_select_public ON public.users;

-- Own-row SELECT remains for defense in depth if table SELECT is ever re-granted.
DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
  FOR SELECT
  USING (auth.uid() = id);

-- Unrestricted UPDATE/INSERT policies let PostgREST change creator_status / account_status.
DROP POLICY IF EXISTS users_update_own ON public.users;
DROP POLICY IF EXISTS users_insert_own ON public.users;

-- Table-level grants, not RLS alone, control which columns a role may UPDATE.
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.username_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.username_reservations TO service_role;

REVOKE ALL ON TABLE public.user_public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_public_profiles TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.users_protect_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'users: client insert is not allowed'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.creator_status IS DISTINCT FROM OLD.creator_status
      OR NEW.account_status IS DISTINCT FROM OLD.account_status
      OR NEW.auth_provider IS DISTINCT FROM OLD.auth_provider
      OR NEW.email_mirrored IS DISTINCT FROM OLD.email_mirrored
      OR NEW.followers_count IS DISTINCT FROM OLD.followers_count
      OR NEW.following_count IS DISTINCT FROM OLD.following_count
      OR NEW.collection_count IS DISTINCT FROM OLD.collection_count
      OR NEW.counters_updated_at IS DISTINCT FROM OLD.counters_updated_at
      OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'users: privileged columns are not client-writable'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_privileged_columns ON public.users;
CREATE TRIGGER users_protect_privileged_columns
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_protect_privileged_columns();

REVOKE ALL ON FUNCTION public.users_protect_privileged_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.users_protect_privileged_columns() TO anon, authenticated, service_role;
