-- Behaviour checks for 20261014120000_notifications_push_revocation.sql. Runs after
-- notifications_push_checks.sql in the same scratch database and reuses its t.* helpers.

CREATE FUNCTION t.hash(p_secret text) RETURNS text LANGUAGE sql AS $$
  SELECT encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
$$;

CREATE FUNCTION t.register_rev(p_user uuid, p_installation uuid, p_token text, p_secret text)
RETURNS bigint LANGUAGE sql AS $$
  SELECT r.registration_id FROM public.notification_register_push_with_revocation(p_user, p_installation, 'expo',
    p_token, 'ios', '1.0.0', '1', 'en-US', 'UTC', 'granted', 'production', t.hash(p_secret)) r;
$$;

CREATE FUNCTION t.bound_to(p_installation uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.user_id FROM public.push_registrations r WHERE r.installation_id = p_installation LIMIT 1;
$$;

SELECT t.run('revocation: column, check, trigger and grants', $c$
  SELECT t.check(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'push_registrations' AND column_name = 'revocation_hash')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_registrations_revocation_hash_chk')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'push_registrations_revocation_guard')
    AND NOT has_function_privilege('anon', 'public.notification_revoke_installation(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notification_revoke_installation(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.notification_register_push_with_revocation(uuid, uuid, text, text, text, text, text, text, text, text, text, text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notification_revoke_installation(uuid, text)', 'EXECUTE'),
    'revocation: column, check, trigger and grants');
$c$);

SELECT t.run('revocation: only the hash is stored; malformed hashes are rejected', $c$
  DO $$
  DECLARE u uuid := t.user_(); i uuid := gen_random_uuid(); stored text; rejected boolean := false;
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-store]', 'secret-store');
    SELECT r.revocation_hash INTO stored FROM public.push_registrations r WHERE r.installation_id = i;
    BEGIN
      PERFORM public.notification_register_push_with_revocation(u, i, 'expo', 'ExponentPushToken[rev-store]', 'ios',
        NULL, NULL, NULL, NULL, 'granted', NULL, 'not-a-hash');
    EXCEPTION WHEN invalid_parameter_value THEN rejected := true;
    END;
    PERFORM t.check(stored = t.hash('secret-store') AND stored <> 'secret-store' AND rejected,
      'revocation: only the hash is stored; malformed hashes are rejected');
  END $$;
$c$);

SELECT t.run('revocation: the right secret unbinds, suppresses open deliveries, and is single-use', $c$
  DO $$
  DECLARE u uuid := t.user_(); i uuid := gen_random_uuid(); n uuid; d bigint; first boolean; second boolean;
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-ok]', 'secret-ok');
    SELECT m.notification_id INTO n FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task')) m;
    d := t.delivery_of(n);
    first := public.notification_revoke_installation(i, t.hash('secret-ok'));
    second := public.notification_revoke_installation(i, t.hash('secret-ok'));
    PERFORM t.check(first AND NOT second AND t.bound_to(i) IS NULL AND t.status(d) = 'suppressed'
      AND (SELECT suppressed_reason FROM public.notification_deliveries WHERE id = d) = 'installation_signed_out'
      AND (SELECT revocation_hash FROM public.push_registrations WHERE installation_id = i) IS NULL
      AND EXISTS (SELECT 1 FROM public.notifications WHERE id = n),
      'revocation: the right secret unbinds, suppresses open deliveries, and is single-use',
      format('first=%s second=%s status=%s', first, second, t.status(d)));
  END $$;
$c$);

SELECT t.run('revocation: a wrong secret changes nothing', $c$
  DO $$
  DECLARE u uuid := t.user_(); i uuid := gen_random_uuid(); ok boolean;
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-wrong]', 'secret-right');
    ok := public.notification_revoke_installation(i, t.hash('secret-guess'));
    PERFORM t.check(NOT ok AND t.bound_to(i) = u
      AND NOT public.notification_revoke_installation(i, NULL)
      AND NOT public.notification_revoke_installation(i, 'secret-right'),
      'revocation: a wrong secret changes nothing');
  END $$;
$c$);

SELECT t.run('revocation: one installation''s secret cannot revoke another installation', $c$
  DO $$
  DECLARE u uuid := t.user_(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); ok boolean;
  BEGIN
    PERFORM t.register_rev(u, a, 'ExponentPushToken[rev-a]', 'secret-a');
    PERFORM t.register_rev(u, b, 'ExponentPushToken[rev-b]', 'secret-b');
    ok := public.notification_revoke_installation(b, t.hash('secret-a'));
    PERFORM t.check(NOT ok AND t.bound_to(b) = u AND t.bound_to(a) = u,
      'revocation: one installation''s secret cannot revoke another installation');
  END $$;
$c$);

SELECT t.run('revocation: after an account switch the previous user''s secret cannot unbind the new user', $c$
  DO $$
  DECLARE ua uuid := t.user_(); ub uuid := t.user_(); i uuid := gen_random_uuid(); ok boolean;
  BEGIN
    PERFORM t.register_rev(ua, i, 'ExponentPushToken[rev-switch]', 'secret-a');
    PERFORM t.register_rev(ub, i, 'ExponentPushToken[rev-switch]', 'secret-b');
    ok := public.notification_revoke_installation(i, t.hash('secret-a'));
    PERFORM t.check(NOT ok AND t.bound_to(i) = ub
      AND public.notification_revoke_installation(i, t.hash('secret-b')) AND t.bound_to(i) IS NULL,
      'revocation: after an account switch the previous user''s secret cannot unbind the new user');
  END $$;
$c$);

SELECT t.run('revocation: re-registering rotates the secret', $c$
  DO $$
  DECLARE u uuid := t.user_(); i uuid := gen_random_uuid(); old_ok boolean;
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-rotate]', 'secret-1');
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-rotate]', 'secret-2');
    old_ok := public.notification_revoke_installation(i, t.hash('secret-1'));
    PERFORM t.check(NOT old_ok AND t.bound_to(i) = u
      AND public.notification_revoke_installation(i, t.hash('secret-2')),
      'revocation: re-registering rotates the secret');
  END $$;
$c$);

SELECT t.run('revocation: a session unlink or a rebind through any RPC consumes the secret', $c$
  DO $$
  DECLARE u uuid := t.user_(); other uuid := t.user_(); i uuid := gen_random_uuid(); j uuid := gen_random_uuid();
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-unlink]', 'secret-unlink');
    PERFORM public.notification_unregister_installation(u, i);
    PERFORM t.register(u, i, 'ExponentPushToken[rev-unlink]');
    PERFORM t.register_rev(u, j, 'ExponentPushToken[rev-rebind]', 'secret-rebind');
    PERFORM t.register(other, j, 'ExponentPushToken[rev-rebind]');
    PERFORM t.check(
      NOT public.notification_revoke_installation(i, t.hash('secret-unlink')) AND t.bound_to(i) = u
      AND NOT public.notification_revoke_installation(j, t.hash('secret-rebind')) AND t.bound_to(j) = other,
      'revocation: a session unlink or a rebind through any RPC consumes the secret');
  END $$;
$c$);

SELECT t.run('revocation: an unbound installation cannot be revoked', $c$
  DO $$
  DECLARE u uuid := t.user_(); i uuid := gen_random_uuid();
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-unbound]', 'secret-unbound');
    UPDATE public.push_registrations SET user_id = NULL WHERE installation_id = i;
    UPDATE public.push_registrations SET revocation_hash = t.hash('secret-unbound') WHERE installation_id = i;
    PERFORM t.check(
      (SELECT revocation_hash FROM public.push_registrations WHERE installation_id = i) = t.hash('secret-unbound')
      AND NOT public.notification_revoke_installation(i, t.hash('secret-unbound')),
      'revocation: an unbound installation cannot be revoked');
  END $$;
$c$);

SELECT t.run('revocation: account purge removes the registration and its secret', $c$
  DO $$
  DECLARE u uuid := t.user_(); i uuid := gen_random_uuid(); r jsonb;
  BEGIN
    PERFORM t.register_rev(u, i, 'ExponentPushToken[rev-purge]', 'secret-purge');
    r := public.notification_purge_user(u, 1000);
    PERFORM t.check(NOT EXISTS (SELECT 1 FROM public.push_registrations WHERE installation_id = i)
      AND NOT public.notification_revoke_installation(i, t.hash('secret-purge')),
      'revocation: account purge removes the registration and its secret');
  END $$;
$c$);
