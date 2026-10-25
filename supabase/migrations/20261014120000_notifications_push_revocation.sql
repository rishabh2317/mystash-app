-- Notifications Phase 5: installation-scoped push revocation credential.
-- Additive over 20261013120000_notifications_push.sql. Each successful registration stores the
-- sha256 (hex) of a fresh random secret held only by that installation. The secret can do one
-- thing: unbind that installation from the user it is currently bound to (offline sign-out
-- replay). It is not an account credential and cannot reach any other registration.
-- Service-role only, like every other notification RPC.

ALTER TABLE public.push_registrations
  ADD COLUMN IF NOT EXISTS revocation_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_registrations_revocation_hash_chk') THEN
    ALTER TABLE public.push_registrations
      ADD CONSTRAINT push_registrations_revocation_hash_chk CHECK (revocation_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- Same contract as notification_register_push, plus the new revocation hash, in one transaction.
-- The previous hash (if any) stops working: a lost response is repaired by the next registration.
CREATE OR REPLACE FUNCTION public.notification_register_push_with_revocation(
  p_user_id uuid, p_installation_id uuid, p_provider text, p_token text, p_platform text,
  p_app_version text, p_app_build text, p_locale text, p_timezone text, p_os_permission text,
  p_apns_environment text, p_revocation_hash text)
RETURNS TABLE (registration_id bigint, previous_user_id uuid, token_moved_from_user uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id    bigint;
  v_prev  uuid;
  v_moved uuid;
BEGIN
  IF p_revocation_hash IS NULL OR p_revocation_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_revocation_hash' USING ERRCODE = '22023';
  END IF;

  SELECT r.registration_id, r.previous_user_id, r.token_moved_from_user INTO v_id, v_prev, v_moved
  FROM public.notification_register_push(p_user_id, p_installation_id, p_provider, p_token, p_platform,
    p_app_version, p_app_build, p_locale, p_timezone, p_os_permission, p_apns_environment) r;

  -- One live secret per installation: other provider rows for it never carry a stale one.
  UPDATE public.push_registrations r
     SET revocation_hash = CASE WHEN r.id = v_id THEN p_revocation_hash END
   WHERE r.installation_id = p_installation_id;

  RETURN QUERY SELECT v_id, v_prev, v_moved;
END;
$$;

-- Unauthenticated path (the caller proves possession of the installation's secret, nothing else).
-- Unbinds only that installation from its current user, suppresses that user's open deliveries
-- on it, and consumes the secret. Returns false for any mismatch, unbound or unknown row.
CREATE OR REPLACE FUNCTION public.notification_revoke_installation(p_installation_id uuid, p_revocation_hash text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_revocation_hash IS NULL OR p_revocation_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ntf-install:' || p_installation_id::text, 0));

  SELECT r.user_id INTO v_user
  FROM public.push_registrations r
  WHERE r.installation_id = p_installation_id
    AND r.revocation_hash = p_revocation_hash
    AND r.user_id IS NOT NULL
  FOR UPDATE;
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.push_registrations r
     SET user_id = NULL, user_bound_at = NULL, revocation_hash = NULL, updated_at = now()
   WHERE r.installation_id = p_installation_id AND r.user_id = v_user;

  UPDATE public.notification_deliveries d
     SET status = 'suppressed', suppressed_reason = 'installation_signed_out', lease_token = NULL,
         lease_until = NULL, terminal_at = now(), updated_at = now()
   WHERE d.installation_id = p_installation_id AND d.recipient_user_id = v_user
     AND d.status IN ('pending', 'retry_scheduled', 'dispatching', 'sending');
  RETURN true;
END;
$$;

-- A secret is bound to one (installation, user) pairing. Any change of user on the row, through
-- any RPC (rebind, session unlink, purge's ON DELETE SET NULL), consumes it.
CREATE OR REPLACE FUNCTION public.notification_push_registration_revocation_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.revocation_hash IS NOT DISTINCT FROM OLD.revocation_hash THEN
    NEW.revocation_hash := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_registrations_revocation_guard ON public.push_registrations;
CREATE TRIGGER push_registrations_revocation_guard
  BEFORE UPDATE ON public.push_registrations
  FOR EACH ROW EXECUTE FUNCTION public.notification_push_registration_revocation_guard();

REVOKE ALL ON FUNCTION public.notification_register_push_with_revocation(uuid, uuid, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_revoke_installation(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_push_registration_revocation_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_register_push_with_revocation(uuid, uuid, text, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_revoke_installation(uuid, text) TO service_role;
