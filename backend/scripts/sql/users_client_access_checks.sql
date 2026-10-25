-- Scratch-Postgres checks for 20261015200000_users_client_access.sql.
-- Never point this at a remote database.

CREATE SCHEMA t;
CREATE TABLE t.results (n serial, label text, ok boolean, detail text);

CREATE FUNCTION t.check(p_ok boolean, p_label text, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO t.results (label, ok, detail) VALUES (p_label, COALESCE(p_ok, false), p_detail);
$$;

CREATE FUNCTION t.user_(p_username text, p_email text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO auth.users DEFAULT VALUES RETURNING id INTO v;
  INSERT INTO public.users (id, username, display_name, email_mirrored, auth_provider, bio)
  VALUES (v, p_username, p_username, p_email, 'email', 'hello');
  RETURN v;
END $$;

DO $$
DECLARE
  alice uuid;
  bob uuid;
  upd_ok boolean;
  sel_ok boolean;
  ins_ok boolean;
  view_email boolean;
  view_row public.user_public_profiles%ROWTYPE;
  restored_sel int;
BEGIN
  alice := t.user_('alice_sec', 'alice@example.com');
  bob := t.user_('bob_sec', 'bob@example.com');

  PERFORM t.check(
    NOT has_table_privilege('anon', 'public.users', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.users', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.users', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.users', 'DELETE'),
    'anon: no table privileges on public.users');

  PERFORM t.check(
    NOT has_table_privilege('authenticated', 'public.users', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.users', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.users', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.users', 'DELETE'),
    'authenticated: no table privileges on public.users');

  PERFORM t.check(
    NOT has_column_privilege('anon', 'public.users', 'email_mirrored', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.users', 'email_mirrored', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.users', 'creator_status', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.users', 'account_status', 'UPDATE'),
    'clients: no SELECT on email_mirrored or UPDATE on status columns');

  PERFORM t.check(
    has_table_privilege('anon', 'public.user_public_profiles', 'SELECT')
    AND has_table_privilege('authenticated', 'public.user_public_profiles', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.user_public_profiles', 'UPDATE'),
    'clients: SELECT-only on user_public_profiles');

  PERFORM t.check(
    has_table_privilege('service_role', 'public.users', 'SELECT')
    AND has_table_privilege('service_role', 'public.users', 'UPDATE')
    AND has_table_privilege('service_role', 'public.users', 'INSERT'),
    'service_role: full access on public.users');

  PERFORM t.check(
    NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_public_profiles'
        AND column_name IN (
          'email_mirrored', 'account_status', 'auth_provider', 'deleted_at',
          'country', 'language', 'timezone', 'country_detected_at',
          'last_location_check_at', 'country_source', 'schema_version', 'extensions'
        )
    ),
    'user_public_profiles: no private columns');

  SELECT * INTO view_row FROM public.user_public_profiles WHERE username = 'bob_sec';
  PERFORM t.check(
    view_row.id = bob
    AND view_row.username = 'bob_sec'
    AND view_row.bio = 'hello'
    AND view_row.creator_status = 'NONE',
    'user_public_profiles: public fields for bob');

  BEGIN
    EXECUTE 'SELECT email_mirrored FROM public.user_public_profiles';
    view_email := true;
  EXCEPTION WHEN undefined_column THEN
    view_email := false;
  END;
  PERFORM t.check(NOT view_email, 'user_public_profiles: email_mirrored is not selectable');

  -- Session as the profile owner: PostgREST-equivalent UPDATE of creator_status must fail.
  PERFORM set_config('request.jwt.claim.sub', alice::text, true);
  BEGIN
    SET ROLE authenticated;
    UPDATE public.users SET creator_status = 'ACTIVE' WHERE id = alice;
    upd_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    RESET ROLE;
    upd_ok := false;
  END;
  PERFORM t.check(NOT upd_ok, 'authenticated: cannot UPDATE own creator_status');

  BEGIN
    SET ROLE authenticated;
    UPDATE public.users SET account_status = 'SUSPENDED' WHERE id = alice;
    upd_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    RESET ROLE;
    upd_ok := false;
  END;
  PERFORM t.check(NOT upd_ok, 'authenticated: cannot UPDATE own account_status');

  BEGIN
    SET ROLE authenticated;
    UPDATE public.users SET email_mirrored = 'pwned@example.com' WHERE id = alice;
    upd_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    RESET ROLE;
    upd_ok := false;
  END;
  PERFORM t.check(NOT upd_ok, 'authenticated: cannot UPDATE own email_mirrored');

  BEGIN
    SET ROLE authenticated;
    INSERT INTO public.users (id, username) VALUES (gen_random_uuid(), 'eve_sec');
    ins_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    RESET ROLE;
    ins_ok := false;
  END;
  PERFORM t.check(NOT ins_ok, 'authenticated: cannot INSERT public.users');

  BEGIN
    SET ROLE authenticated;
    PERFORM (SELECT email_mirrored FROM public.users WHERE id = bob);
    sel_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    sel_ok := false;
  END;
  PERFORM t.check(NOT sel_ok, 'authenticated: cannot SELECT other user private columns on public.users');

  BEGIN
    SET ROLE anon;
    PERFORM (SELECT email_mirrored FROM public.users WHERE id = bob);
    sel_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    sel_ok := false;
  END;
  PERFORM t.check(NOT sel_ok, 'anon: cannot SELECT private columns on public.users');

  BEGIN
    SET ROLE anon;
    PERFORM 1 FROM public.user_public_profiles WHERE username = 'bob_sec';
    sel_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    sel_ok := false;
  END;
  PERFORM t.check(sel_ok, 'anon: can SELECT user_public_profiles');

  -- If table SELECT were re-granted, RLS must still hide other users' rows.
  GRANT SELECT ON TABLE public.users TO authenticated;
  PERFORM set_config('request.jwt.claim.sub', alice::text, true);
  BEGIN
    SET ROLE authenticated;
    SELECT count(*) INTO restored_sel FROM public.users WHERE id = bob;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    restored_sel := -1;
  END;
  PERFORM t.check(restored_sel = 0, 'RLS: authenticated cannot read another user row even with SELECT grant');
  REVOKE SELECT ON TABLE public.users FROM authenticated;

  -- Trusted backend can still change creator_status (NONE → ONBOARDING → ACTIVE).
  SET ROLE service_role;
  UPDATE public.users SET creator_status = 'ONBOARDING' WHERE id = alice;
  UPDATE public.users SET creator_status = 'ACTIVE' WHERE id = alice;
  RESET ROLE;
  PERFORM t.check(
    (SELECT creator_status FROM public.users WHERE id = alice) = 'ACTIVE',
    'service_role: can complete NONE → ONBOARDING → ACTIVE');

  UPDATE public.users SET display_name = 'Alice Updated', bio = 'new bio' WHERE id = alice;
  PERFORM t.check(
    (SELECT display_name FROM public.users WHERE id = alice) = 'Alice Updated'
    AND (SELECT bio FROM public.users WHERE id = alice) = 'new bio',
    'service_role: profile display_name and bio updates still work');
END $$;
