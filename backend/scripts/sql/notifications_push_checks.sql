-- Behaviour checks for the notification migrations (Phase 1 + Phase 4). Scratch Postgres only;
-- run through backend/scripts/notificationsSqlScratch.sh. Each check records PASS/FAIL and never
-- aborts the run, so one invocation reports every failure.

CREATE SCHEMA t;
CREATE TABLE t.results (n serial, label text, ok boolean, detail text);

CREATE FUNCTION t.check(p_ok boolean, p_label text, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO t.results (label, ok, detail) VALUES (p_label, COALESCE(p_ok, false), p_detail); $$;

CREATE FUNCTION t.user_(p_status text DEFAULT 'ACTIVE') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO auth.users DEFAULT VALUES RETURNING id INTO v;
  INSERT INTO public.users (id, account_status) VALUES (v, p_status);
  RETURN v;
END $$;

CREATE FUNCTION t.render(p_type text, p_category text, p_group_key text DEFAULT NULL, p_requires_actor boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('type', p_type, 'category', p_category, 'title', 'Title', 'body', 'Body',
    'data', '{}'::jsonb, 'deep_link', '/notifications', 'group_key', p_group_key,
    'group_window_seconds', CASE WHEN p_group_key IS NULL THEN NULL ELSE 3600 END,
    'requires_actor', p_requires_actor, 'expires_at', NULL);
$$;

-- Mirrors backend/src/notifications/domain/pushPolicy.ts.
CREATE FUNCTION t.push(p_category text, p_rate_cap int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('enabled', true,
    'ttl_seconds', CASE p_category WHEN 'social' THEN 21600 WHEN 'security' THEN 3600 ELSE 86400 END,
    'retry_policy', CASE WHEN p_category IN ('task', 'account', 'security') THEN 'retry_ambiguous_once' ELSE 'no_ambiguous_retry' END,
    'max_send_attempts', 3,
    'cooldown_seconds', CASE WHEN p_category = 'social' THEN 86400 ELSE 0 END,
    'rate_cap', CASE WHEN p_category = 'social' THEN COALESCE(p_rate_cap, 10) END,
    'rate_window_seconds', 86400,
    'provider_preference', jsonb_build_array('expo'));
$$;

-- Enqueue + claim one specific row + materialize. Returns (outcome, notification_id, deliveries).
CREATE FUNCTION t.mat(p_recipient uuid, p_render jsonb, p_push jsonb, p_actor uuid DEFAULT NULL,
                      p_occurred timestamptz DEFAULT now())
RETURNS TABLE (outcome text, notification_id uuid, deliveries int) LANGUAGE plpgsql AS $$
DECLARE v_out bigint; v_lease uuid := gen_random_uuid();
BEGIN
  SELECT e.outbox_id INTO v_out FROM public.notification_enqueue_event(
    p_render->>'type', gen_random_uuid()::text, p_recipient, p_actor, p_occurred, '{}'::jsonb, 1::smallint, 2592000) e;
  UPDATE public.notification_outbox o SET status = 'claimed', lease_token = v_lease,
    lease_until = now() + interval '60 seconds', available_at = now() + interval '60 seconds', claim_count = 1
  WHERE o.id = v_out;
  IF p_push IS NULL THEN
    RETURN QUERY SELECT m.outcome, m.notification_id, m.deliveries_created
      FROM public.notification_materialize(v_out, v_lease, p_render) m;
  ELSE
    RETURN QUERY SELECT m.outcome, m.notification_id, m.deliveries_created
      FROM public.notification_materialize(v_out, v_lease, p_render, p_push) m;
  END IF;
END $$;

CREATE FUNCTION t.register(p_user uuid, p_installation uuid, p_token text, p_permission text DEFAULT 'granted')
RETURNS bigint LANGUAGE sql AS $$
  SELECT r.registration_id FROM public.notification_register_push(p_user, p_installation, 'expo', p_token, 'ios',
    '1.0.0', '1', 'en-US', 'UTC', p_permission, 'production') r;
$$;

CREATE FUNCTION t.delivery_of(p_notification uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT d.id FROM public.notification_deliveries d WHERE d.notification_id = p_notification ORDER BY d.id LIMIT 1;
$$;

-- Claims exactly one delivery via the real claim RPC (others are parked) and begins the send.
CREATE FUNCTION t.begin(p_delivery bigint) RETURNS TABLE (token uuid, attempt int, rows_begun int) LANGUAGE plpgsql AS $$
DECLARE v_token uuid; v_attempt int; v_rows int;
BEGIN
  UPDATE public.notification_deliveries d SET available_at = d.available_at + interval '100 years'
   WHERE d.id <> p_delivery AND d.status IN ('pending', 'retry_scheduled', 'dispatching');
  UPDATE public.notification_deliveries d SET available_at = now() - interval '1 second'
   WHERE d.id = p_delivery AND d.status IN ('pending', 'retry_scheduled');
  SELECT c.dispatch_token INTO v_token FROM public.notification_claim_push_deliveries('expo', 100, 60, 10) c LIMIT 1;
  UPDATE public.notification_deliveries d SET available_at = d.available_at - interval '100 years'
   WHERE d.id <> p_delivery AND d.status IN ('pending', 'retry_scheduled', 'dispatching');
  SELECT count(*)::int, max(b.attempt_no) INTO v_rows, v_attempt FROM public.notification_begin_push_send(v_token, 120) b;
  RETURN QUERY SELECT v_token, v_attempt, v_rows;
END $$;

CREATE FUNCTION t.result(p_token uuid, p_delivery bigint, p_attempt int, p_class text, p_code text,
                         p_ticket text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.notification_record_push_results(p_token, jsonb_build_array(jsonb_build_object(
    'delivery_id', p_delivery, 'attempt_no', p_attempt, 'outcome_class', p_class, 'outcome_code', p_code,
    'provider_code', p_code, 'provider_message', NULL, 'http_status', 200, 'retry_after_ms', NULL,
    'provider_message_id', p_ticket, 'latency_ms', 12)));
$$;

CREATE FUNCTION t.status(p_delivery bigint) RETURNS text LANGUAGE sql AS $$
  SELECT d.status FROM public.notification_deliveries d WHERE d.id = p_delivery;
$$;

CREATE FUNCTION t.lose_worker(p_delivery bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.notification_deliveries d SET lease_until = now() - interval '1 second' WHERE d.id = p_delivery;
  RETURN public.notification_sweep(10, 1000);
END $$;

-- Runs one check body; an unexpected error is a FAIL with the message, never an abort.
CREATE FUNCTION t.run(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
EXCEPTION WHEN OTHERS THEN
  PERFORM t.check(false, p_label, 'error: ' || SQLERRM);
END $$;

-- ===========================================================================
-- Schema, RLS, privileges
-- ===========================================================================

SELECT t.run('schema: push tables exist with RLS on and no policies', $c$
  SELECT t.check(
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relrowsecurity
        AND c.relname IN ('push_registrations', 'notification_deliveries', 'notification_delivery_attempts')) = 3
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename IN
        ('push_registrations', 'notification_deliveries', 'notification_delivery_attempts')),
    'schema: push tables exist with RLS on and no policies');
$c$);

SELECT t.run('schema: planned indexes exist', $c$
  SELECT t.check(
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
      'push_registrations_user_active_idx', 'notification_deliveries_due_idx', 'notification_deliveries_deadline_idx',
      'notification_deliveries_sending_idx', 'notification_deliveries_open_by_installation_idx',
      'notification_deliveries_prune_idx', 'notification_attempts_receipt_due_idx', 'notification_attempts_prune_idx')) = 8,
    'schema: planned indexes exist');
$c$);

SELECT t.run('privileges: anon/authenticated cannot read push tables or call push RPCs', $c$
  SELECT t.check(
    NOT has_table_privilege('anon', 'public.push_registrations', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.push_registrations', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT')
    AND NOT has_function_privilege('anon', 'public.notification_register_push(uuid, uuid, text, text, text, text, text, text, text, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notification_begin_push_send(uuid, int)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notification_materialize(bigint, uuid, jsonb, jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notification_record_push_results(uuid, jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notification_prune(int, int, int, int, int, int, int)', 'EXECUTE'),
    'privileges: anon/authenticated cannot read push tables or call push RPCs');
$c$);

SELECT t.run('replaced functions: only the new materialize/prune signatures remain', $c$
  SELECT t.check(
    (SELECT count(*) FROM pg_proc WHERE proname = 'notification_materialize') = 1
    AND (SELECT pronargs FROM pg_proc WHERE proname = 'notification_materialize') = 4
    AND (SELECT count(*) FROM pg_proc WHERE proname = 'notification_prune') = 1
    AND (SELECT pronargs FROM pg_proc WHERE proname = 'notification_prune') = 7,
    'replaced functions: only the new materialize/prune signatures remain');
$c$);

-- ===========================================================================
-- Phase 1–3 backward compatibility (push disabled = p_push NULL)
-- ===========================================================================

SELECT t.run('compat: 3-arg materialize call creates inbox row with not_applicable and no deliveries', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; n public.notifications%ROWTYPE;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[compat-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.ready_for_review', 'task'), NULL);
    SELECT * INTO n FROM public.notifications WHERE id = m.notification_id;
    PERFORM t.check(m.outcome = 'created' AND m.deliveries = 0 AND n.push_decision = 'not_applicable'
      AND n.inbox_visible AND NOT EXISTS (SELECT 1 FROM public.notification_deliveries d WHERE d.notification_id = n.id),
      'compat: 3-arg materialize call creates inbox row with not_applicable and no deliveries');
  END $$;
$c$);

SELECT t.run('compat: push disabled + social inbox off still stores nothing', $c$
  DO $$
  DECLARE u uuid := t.user_(); a uuid := t.user_(); m record;
  BEGIN
    INSERT INTO public.notification_preferences VALUES (u, 'social', 'inbox', false, now());
    SELECT * INTO m FROM t.mat(u, t.render('creator.followed', 'social', 'g-' || u, true), NULL, a);
    PERFORM t.check(m.outcome = 'suppressed_preference' AND m.notification_id IS NULL,
      'compat: push disabled + social inbox off still stores nothing');
  END $$;
$c$);

SELECT t.run('compat: aggregation, unread count, mark read/seen, record open unchanged', $c$
  DO $$
  DECLARE u uuid := t.user_(); a1 uuid := t.user_(); a2 uuid := t.user_(); m1 record; m2 record; m3 record;
          n public.notifications%ROWTYPE; v_unread int; v_seen int; v_read int;
  BEGIN
    SELECT * INTO m1 FROM t.mat(u, t.render('creator.followed', 'social', 'agg-' || u, true), NULL, a1);
    SELECT * INTO m2 FROM t.mat(u, t.render('creator.followed', 'social', 'agg-' || u, true), NULL, a2);
    SELECT * INTO m3 FROM t.mat(u, t.render('creator.followed', 'social', 'agg-' || u, true), NULL, a2);
    SELECT * INTO n FROM public.notifications WHERE id = m1.notification_id;
    v_unread := public.notification_unread_count(u);
    v_seen := public.notification_mark_seen(u, n.sort_at, n.id);
    v_read := public.notification_mark_read(u, NULL, NULL, NULL);
    PERFORM t.check(m1.outcome = 'created' AND m2.outcome = 'aggregated' AND m3.outcome = 'aggregated'
      AND m2.notification_id = m1.notification_id AND n.actor_count = 2 AND n.event_count = 3
      AND v_unread = 1 AND v_seen = 1 AND v_read = 1 AND public.notification_unread_count(u) = 0
      AND public.notification_record_open(u, n.id) AND NOT public.notification_record_open(t.user_(), n.id),
      'compat: aggregation, unread count, mark read/seen, record open unchanged',
      format('outcomes %s/%s/%s actors %s events %s unread %s', m1.outcome, m2.outcome, m3.outcome, n.actor_count, n.event_count, v_unread));
  END $$;
$c$);

SELECT t.run('compat: enqueue dedupe and stale cutoff unchanged', $c$
  DO $$
  DECLARE u uuid := t.user_(); r1 text; r2 text; r3 text;
  BEGIN
    SELECT outcome INTO r1 FROM public.notification_enqueue_event('ingest.failed', 'k-' || u, u, NULL, now(), '{}', 1::smallint, 2592000);
    SELECT outcome INTO r2 FROM public.notification_enqueue_event('ingest.failed', 'k-' || u, u, NULL, now(), '{}', 1::smallint, 2592000);
    SELECT outcome INTO r3 FROM public.notification_enqueue_event('ingest.failed', 'k2-' || u, u, NULL, now() - interval '31 days', '{}', 1::smallint, 2592000);
    PERFORM t.check(r1 = 'enqueued' AND r2 = 'duplicate' AND r3 = 'stale', 'compat: enqueue dedupe and stale cutoff unchanged');
  END $$;
$c$);

SELECT t.run('compat: prune with Phase 1 named arguments still works (delivery days default)', $c$
  SELECT t.check(public.notification_prune(p_batch => 100, p_outbox_processed_days => 7, p_outbox_dead_days => 30,
      p_event_key_days => 120, p_stale_after_days => 30, p_inbox_days => 90) ? 'deliveries',
    'compat: prune with Phase 1 named arguments still works (delivery days default)');
$c$);

SELECT t.run('compat: prune still refuses event-key retention <= stale cutoff', $c$
  DO $$
  BEGIN
    BEGIN
      PERFORM public.notification_prune(100, 7, 30, 30, 30, 90);
      PERFORM t.check(false, 'compat: prune still refuses event-key retention <= stale cutoff');
    EXCEPTION WHEN invalid_parameter_value THEN
      PERFORM t.check(true, 'compat: prune still refuses event-key retention <= stale cutoff');
    END;
  END $$;
$c$);

SELECT t.run('compat: sweep keeps outbox dead-lettering and reports push counters', $c$
  DO $$
  DECLARE u uuid := t.user_(); v_out bigint; s jsonb;
  BEGIN
    SELECT outbox_id INTO v_out FROM public.notification_enqueue_event('ingest.failed', 'sw-' || u, u, NULL, now(), '{}', 1::smallint, 2592000);
    UPDATE public.notification_outbox SET claim_count = 10 WHERE id = v_out;
    s := public.notification_sweep(10, 1000);
    PERFORM t.check((s->>'outbox_dead')::int >= 1 AND (SELECT status FROM public.notification_outbox WHERE id = v_out) = 'dead'
      AND s ? 'deliveries_expired' AND s ? 'deliveries_failed_dispatch' AND s ? 'sending_abandoned',
      'compat: sweep keeps outbox dead-lettering and reports push counters', s::text);
  END $$;
$c$);

-- ===========================================================================
-- Push decision in materialize
-- ===========================================================================

SELECT t.run('decision: task push queued with one delivery and 24 h deadline', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; d public.notification_deliveries%ROWTYPE;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[task-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.ready_for_review', 'task'), t.push('task'));
    SELECT * INTO d FROM public.notification_deliveries WHERE notification_id = m.notification_id;
    PERFORM t.check(m.deliveries = 1 AND d.status = 'pending' AND d.retry_policy = 'retry_ambiguous_once'
      AND abs(extract(epoch FROM d.send_deadline - now()) - 86400) < 5
      AND (SELECT push_decision FROM public.notifications WHERE id = m.notification_id) = 'queued',
      'decision: task push queued with one delivery and 24 h deadline');
  END $$;
$c$);

SELECT t.run('decision: one delivery per installation; denied and invalidated registrations skipped', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; r bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[multi-1]');
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[multi-2]');
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[multi-3]', 'denied');
    r := t.register(u, gen_random_uuid(), 'ExponentPushToken[multi-4]');
    UPDATE public.push_registrations SET invalidated_at = now(), invalid_reason = 'device_not_registered' WHERE id = r;
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    PERFORM t.check(m.deliveries = 2, 'decision: one delivery per installation; denied and invalidated registrations skipped', m.deliveries::text);
  END $$;
$c$);

SELECT t.run('decision: no registrations recorded, inbox row kept', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record;
  BEGIN
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    PERFORM t.check(m.outcome = 'created' AND m.deliveries = 0
      AND (SELECT push_decision FROM public.notifications WHERE id = m.notification_id) = 'no_registrations',
      'decision: no registrations recorded, inbox row kept');
  END $$;
$c$);

SELECT t.run('decision: task push preference off -> suppressed_preference, inbox visible', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; n public.notifications%ROWTYPE;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[pref-1]');
    INSERT INTO public.notification_preferences VALUES (u, 'task', 'push', false, now());
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    SELECT * INTO n FROM public.notifications WHERE id = m.notification_id;
    PERFORM t.check(m.deliveries = 0 AND n.inbox_visible AND n.push_decision = 'suppressed_preference',
      'decision: task push preference off -> suppressed_preference, inbox visible');
  END $$;
$c$);

SELECT t.run('decision: kill switch (enabled=false) -> suppressed_kill_switch, no deliveries', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[kill-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task') || '{"enabled": false}');
    PERFORM t.check(m.deliveries = 0
      AND (SELECT push_decision FROM public.notifications WHERE id = m.notification_id) = 'suppressed_kill_switch',
      'decision: kill switch (enabled=false) -> suppressed_kill_switch, no deliveries');
  END $$;
$c$);

SELECT t.run('decision: social inbox off + push on -> push-only row hidden from feed and unread', $c$
  DO $$
  DECLARE u uuid := t.user_(); a uuid := t.user_(); m record; n public.notifications%ROWTYPE;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[pushonly-1]');
    INSERT INTO public.notification_preferences VALUES (u, 'social', 'inbox', false, now());
    SELECT * INTO m FROM t.mat(u, t.render('creator.followed', 'social', 'po-' || u, true), t.push('social'), a);
    SELECT * INTO n FROM public.notifications WHERE id = m.notification_id;
    PERFORM t.check(m.deliveries = 1 AND NOT n.inbox_visible AND n.push_decision = 'queued'
      AND public.notification_unread_count(u) = 0
      AND NOT EXISTS (SELECT 1 FROM public.notification_list_feed(u, NULL, NULL, 50, NULL)),
      'decision: social inbox off + push on -> push-only row hidden from feed and unread');
  END $$;
$c$);

SELECT t.run('decision: social rate cap suppresses push only; inbox rows kept', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; i int; v_decisions text[] := '{}';
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[cap-1]');
    FOR i IN 1..3 LOOP
      SELECT * INTO m FROM t.mat(u, t.render('reel.liked', 'social', 'cap-' || i || '-' || u, true), t.push('social', 2), t.user_());
      v_decisions := v_decisions || (SELECT push_decision FROM public.notifications WHERE id = m.notification_id);
    END LOOP;
    PERFORM t.check(v_decisions = ARRAY['queued', 'queued', 'suppressed_rate_limit']
      AND (SELECT count(*) FROM public.notifications WHERE user_id = u AND inbox_visible) = 3,
      'decision: social rate cap suppresses push only; inbox rows kept', v_decisions::text);
  END $$;
$c$);

SELECT t.run('decision: default social cap is 10 per rolling 24 h', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; i int; v_queued int;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[cap10-1]');
    FOR i IN 1..11 LOOP
      PERFORM t.mat(u, t.render('reel.liked', 'social', 'c10-' || i || '-' || u, true), t.push('social'), t.user_());
    END LOOP;
    SELECT count(*) INTO v_queued FROM public.notifications WHERE user_id = u AND push_decision = 'queued';
    PERFORM t.check(v_queued = 10 AND (SELECT count(*) FROM public.notifications WHERE user_id = u) = 11,
      'decision: default social cap is 10 per rolling 24 h', v_queued::text);
  END $$;
$c$);

SELECT t.run('decision: 24 h cooldown per recipient + group key; task never cooled down', $c$
  DO $$
  DECLARE u uuid := t.user_(); m1 record; m2 record; t1 record; t2 record;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[cool-1]');
    SELECT * INTO m1 FROM t.mat(u, t.render('collection.saved', 'social', 'cool-' || u, true), t.push('social'), t.user_(), now());
    SELECT * INTO m2 FROM t.mat(u, t.render('collection.saved', 'social', 'cool-' || u, true), t.push('social'), t.user_(), now() - interval '3 hours');
    SELECT * INTO t1 FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    SELECT * INTO t2 FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    PERFORM t.check(m1.notification_id <> m2.notification_id
      AND (SELECT push_decision FROM public.notifications WHERE id = m1.notification_id) = 'queued'
      AND (SELECT push_decision FROM public.notifications WHERE id = m2.notification_id) = 'suppressed_cooldown'
      AND t1.deliveries = 1 AND t2.deliveries = 1,
      'decision: 24 h cooldown per recipient + group key; task never cooled down');
  END $$;
$c$);

SELECT t.run('decision: aggregated follow-up events never create more deliveries', $c$
  DO $$
  DECLARE u uuid := t.user_(); m1 record; m2 record;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[aggpush-1]');
    SELECT * INTO m1 FROM t.mat(u, t.render('creator.followed', 'social', 'ap-' || u, true), t.push('social'), t.user_());
    SELECT * INTO m2 FROM t.mat(u, t.render('creator.followed', 'social', 'ap-' || u, true), t.push('social'), t.user_());
    PERFORM t.check(m2.outcome = 'aggregated' AND m2.deliveries = 0
      AND (SELECT count(*) FROM public.notification_deliveries WHERE notification_id = m1.notification_id) = 1,
      'decision: aggregated follow-up events never create more deliveries');
  END $$;
$c$);

SELECT t.run('decision: quiet hours delay push; window past the TTL suppresses it', $c$
  DO $$
  DECLARE u1 uuid := t.user_(); u2 uuid := t.user_(); s time := (now() AT TIME ZONE 'UTC')::time - interval '1 hour';
          m1 record; m2 record; d public.notification_deliveries%ROWTYPE;
  BEGIN
    PERFORM t.register(u1, gen_random_uuid(), 'ExponentPushToken[qh-1]');
    PERFORM t.register(u2, gen_random_uuid(), 'ExponentPushToken[qh-2]');
    INSERT INTO public.user_notification_settings (user_id, timezone, quiet_hours_start, quiet_hours_end)
      VALUES (u1, 'UTC', s, s + interval '3 hours'), (u2, 'UTC', s, s + interval '9 hours');
    SELECT * INTO m1 FROM t.mat(u1, t.render('ingest.failed', 'task'), t.push('task'));
    SELECT * INTO d FROM public.notification_deliveries WHERE notification_id = m1.notification_id;
    SELECT * INTO m2 FROM t.mat(u2, t.render('reel.liked', 'social', 'qh-' || u2, true), t.push('social'), t.user_());
    PERFORM t.check(m1.deliveries = 1 AND d.available_at > now() + interval '100 minutes'
      AND (SELECT push_decision FROM public.notifications WHERE id = m2.notification_id) = 'suppressed_quiet_hours',
      'decision: quiet hours delay push; window past the TTL suppresses it');
  END $$;
$c$);

SELECT t.run('decision: suspended recipient still suppressed before any push work', $c$
  DO $$
  DECLARE u uuid := t.user_('SUSPENDED'); m record;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[susp-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    PERFORM t.check(m.outcome = 'suppressed_recipient' AND m.deliveries = 0, 'decision: suspended recipient still suppressed before any push work');
  END $$;
$c$);

-- ===========================================================================
-- Delivery state machine (plan section 5.2)
-- ===========================================================================

SELECT t.run('send: claim+begin opens attempt 1; accepted -> provider_accepted with pending receipt', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; a public.notification_delivery_attempts%ROWTYPE; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[send-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.result(b.token, dl, b.attempt, 'accepted', 'ok', 'ticket-1');
    SELECT * INTO a FROM public.notification_delivery_attempts WHERE delivery_id = dl;
    PERFORM t.check(b.rows_begun = 1 AND b.attempt = 1 AND t.status(dl) = 'provider_accepted'
      AND a.receipt_status = 'pending' AND a.provider_message_id = 'ticket-1' AND a.finished_at IS NOT NULL
      AND a.token_fingerprint = public.notification_token_fingerprint('ExponentPushToken[send-1]'),
      'send: claim+begin opens attempt 1; accepted -> provider_accepted with pending receipt');
  END $$;
$c$);

SELECT t.run('send: duplicate result and a stale/redelivered dispatch token are no-ops', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; r jsonb; v_again int;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[dup-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.result(b.token, dl, b.attempt, 'accepted', 'ok', 'ticket-dup');
    r := t.result(b.token, dl, b.attempt, 'permanent_message', 'unknown');
    SELECT count(*) INTO v_again FROM public.notification_begin_push_send(b.token, 120);
    PERFORM t.check((r->>'duplicates')::int = 1 AND t.status(dl) = 'provider_accepted' AND v_again = 0
      AND (SELECT count(*) FROM public.notification_delivery_attempts WHERE delivery_id = dl) = 1,
      'send: duplicate result and a stale/redelivered dispatch token are no-ops', r::text);
  END $$;
$c$);

SELECT t.run('send: retryable backs off until max attempts, then failed_exhausted', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; s1 text; s2 text; v_next timestamptz;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[retry-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'retryable', 'provider_unavailable');
    s1 := t.status(dl);
    SELECT available_at INTO v_next FROM public.notification_deliveries WHERE id = dl;
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'retryable', 'rate_limited');
    s2 := t.status(dl);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'retryable', 'rate_limited');
    PERFORM t.check(s1 = 'retry_scheduled' AND v_next > now() + interval '20 seconds' AND s2 = 'retry_scheduled'
      AND b.attempt = 3 AND t.status(dl) = 'failed_exhausted'
      AND (SELECT terminal_at FROM public.notification_deliveries WHERE id = dl) IS NOT NULL,
      'send: retryable backs off until max attempts, then failed_exhausted', format('%s %s %s', s1, s2, t.status(dl)));
  END $$;
$c$);

SELECT t.run('send: retry_after from the provider is honoured', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[ra-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM public.notification_record_push_results(b.token, jsonb_build_array(jsonb_build_object(
      'delivery_id', dl, 'attempt_no', b.attempt, 'outcome_class', 'retryable', 'outcome_code', 'rate_limited',
      'http_status', 429, 'retry_after_ms', 600000)));
    PERFORM t.check((SELECT available_at FROM public.notification_deliveries WHERE id = dl) > now() + interval '9 minutes',
      'send: retry_after from the provider is honoured');
  END $$;
$c$);

SELECT t.run('send: task ambiguous retries once, second ambiguous is failed_ambiguous', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; s1 text; c1 int;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[amb-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'ambiguous', 'timeout_after_send');
    s1 := t.status(dl); SELECT ambiguous_count INTO c1 FROM public.notification_deliveries WHERE id = dl;
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'ambiguous', 'connection_reset');
    PERFORM t.check(s1 = 'retry_scheduled' AND c1 = 1 AND t.status(dl) = 'failed_ambiguous',
      'send: task ambiguous retries once, second ambiguous is failed_ambiguous');
  END $$;
$c$);

SELECT t.run('send: account ambiguous also retries once', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[amb-acct]');
    SELECT * INTO m FROM t.mat(u, t.render('connected_account.needs_reauth', 'account'), t.push('account'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'ambiguous', 'timeout_after_send');
    PERFORM t.check(t.status(dl) = 'retry_scheduled', 'send: account ambiguous also retries once');
  END $$;
$c$);

SELECT t.run('send: social ambiguous is never retried', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[amb-soc]');
    SELECT * INTO m FROM t.mat(u, t.render('reel.liked', 'social', 'as-' || u, true), t.push('social'), t.user_());
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'ambiguous', 'timeout_after_send');
    PERFORM t.check(t.status(dl) = 'failed_ambiguous', 'send: social ambiguous is never retried');
  END $$;
$c$);

SELECT t.run('send: permanent_token fails permanently and invalidates the registration', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; r bigint;
  BEGIN
    r := t.register(u, gen_random_uuid(), 'ExponentPushToken[perm-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'permanent_token', 'device_unregistered');
    PERFORM t.check(t.status(dl) = 'failed_permanent'
      AND (SELECT invalid_reason FROM public.push_registrations WHERE id = r) = 'device_not_registered',
      'send: permanent_token fails permanently and invalidates the registration');
  END $$;
$c$);

SELECT t.run('send: permanent_message fails without touching the registration', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; r bigint;
  BEGIN
    r := t.register(u, gen_random_uuid(), 'ExponentPushToken[permmsg-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'permanent_message', 'payload_too_large');
    PERFORM t.check(t.status(dl) = 'failed_permanent'
      AND (SELECT invalidated_at FROM public.push_registrations WHERE id = r) IS NULL,
      'send: permanent_message fails without touching the registration');
  END $$;
$c$);

SELECT t.run('send: provider_config retries in 5 min regardless of max attempts', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; i int;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[cfg-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    FOR i IN 1..4 LOOP
      SELECT * INTO b FROM t.begin(dl); PERFORM t.result(b.token, dl, b.attempt, 'provider_config', 'auth_rejected');
    END LOOP;
    PERFORM t.check(b.attempt = 4 AND t.status(dl) = 'retry_scheduled'
      AND (SELECT available_at FROM public.notification_deliveries WHERE id = dl) > now() + interval '4 minutes',
      'send: provider_config retries in 5 min regardless of max attempts');
  END $$;
$c$);

SELECT t.run('send: invalidation is fingerprint-matched (rotated token survives a late result)', $c$
  DO $$
  DECLARE u uuid := t.user_(); inst uuid := gen_random_uuid(); m record; b record; dl bigint; r bigint;
  BEGIN
    r := t.register(u, inst, 'ExponentPushToken[rot-old]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.register(u, inst, 'ExponentPushToken[rot-new]');
    PERFORM t.result(b.token, dl, b.attempt, 'permanent_token', 'device_unregistered');
    PERFORM t.check((SELECT invalidated_at FROM public.push_registrations WHERE id = r) IS NULL
      AND (SELECT token FROM public.push_registrations WHERE id = r) = 'ExponentPushToken[rot-new]',
      'send: invalidation is fingerprint-matched (rotated token survives a late result)');
  END $$;
$c$);

SELECT t.run('send: push preference turned off after materialize -> suppressed preference_changed', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[late-pref]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    INSERT INTO public.notification_preferences VALUES (u, 'task', 'push', false, now());
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.check(b.rows_begun = 0 AND t.status(dl) = 'suppressed'
      AND (SELECT suppressed_reason FROM public.notification_deliveries WHERE id = dl) = 'preference_changed'
      AND NOT EXISTS (SELECT 1 FROM public.notification_delivery_attempts WHERE delivery_id = dl),
      'send: push preference turned off after materialize -> suppressed preference_changed');
  END $$;
$c$);

SELECT t.run('send: recipient suspended after materialize -> suppressed recipient_unavailable', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[late-susp]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    UPDATE public.users SET account_status = 'SUSPENDED' WHERE id = u;
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.check(b.rows_begun = 0
      AND (SELECT suppressed_reason FROM public.notification_deliveries WHERE id = dl) = 'recipient_unavailable',
      'send: recipient suspended after materialize -> suppressed recipient_unavailable');
  END $$;
$c$);

-- ===========================================================================
-- Sweeper: worker lost, claim exhaustion, deadline, late results
-- ===========================================================================

SELECT t.run('late: worker_lost on task -> retry; late accepted wins and history keeps both facts', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; s1 text; a public.notification_delivery_attempts%ROWTYPE;
          d public.notification_deliveries%ROWTYPE;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[lost-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.lose_worker(dl);
    s1 := t.status(dl);
    SELECT * INTO a FROM public.notification_delivery_attempts WHERE delivery_id = dl;
    PERFORM t.check(s1 = 'retry_scheduled' AND a.abandon_reason = 'worker_lost' AND a.outcome_class IS NULL AND a.finished_at IS NULL,
      'late: sweeper abandons the attempt without writing an outcome');
    PERFORM t.result(b.token, dl, b.attempt, 'accepted', 'ok', 'ticket-late');
    SELECT * INTO a FROM public.notification_delivery_attempts WHERE delivery_id = dl;
    SELECT * INTO d FROM public.notification_deliveries WHERE id = dl;
    PERFORM t.check(d.status = 'provider_accepted' AND d.ambiguous_count = 0 AND a.late_result
      AND a.abandoned_at IS NOT NULL AND a.outcome_class = 'accepted' AND a.receipt_status = 'pending'
      AND d.last_outcome_class = 'accepted' AND d.last_outcome_code = 'ok',
      'late: worker_lost on task -> retry; late accepted wins and history keeps both facts');
  END $$;
$c$);

SELECT t.run('late: worker_lost on social -> failed_ambiguous; late permanent -> failed_permanent', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint; s1 text;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[lost-soc]');
    SELECT * INTO m FROM t.mat(u, t.render('reel.liked', 'social', 'ls-' || u, true), t.push('social'), t.user_());
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.lose_worker(dl);
    s1 := t.status(dl);
    PERFORM t.result(b.token, dl, b.attempt, 'permanent_token', 'device_unregistered');
    PERFORM t.check(s1 = 'failed_ambiguous' AND t.status(dl) = 'failed_permanent'
      AND (SELECT last_outcome_code FROM public.notification_deliveries WHERE id = dl) = 'device_unregistered',
      'late: worker_lost on social -> failed_ambiguous; late permanent -> failed_permanent');
  END $$;
$c$);

SELECT t.run('late: result for an older attempt after a newer one began is recorded only', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b1 record; b2 record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[newer-1]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b1 FROM t.begin(dl);
    PERFORM t.lose_worker(dl);
    SELECT * INTO b2 FROM t.begin(dl);
    PERFORM t.result(b1.token, dl, b1.attempt, 'accepted', 'ok', 'ticket-old');
    PERFORM t.check(b2.attempt = 2 AND t.status(dl) = 'sending'
      AND (SELECT outcome_class FROM public.notification_delivery_attempts WHERE delivery_id = dl AND attempt_no = 1) = 'accepted'
      AND (SELECT receipt_status FROM public.notification_delivery_attempts WHERE delivery_id = dl AND attempt_no = 1) = 'not_applicable',
      'late: result for an older attempt after a newer one began is recorded only');
  END $$;
$c$);

SELECT t.run('late: accepted after the delivery expired never resurrects it', $c$
  DO $$
  DECLARE u uuid := t.user_(); m record; b record; dl bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[exp-late]');
    SELECT * INTO m FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.lose_worker(dl);
    UPDATE public.notification_deliveries SET send_deadline = now() - interval '1 second' WHERE id = dl;
    PERFORM public.notification_sweep(10, 1000);
    PERFORM t.result(b.token, dl, b.attempt, 'accepted', 'ok', 'ticket-expired');
    PERFORM t.check(t.status(dl) = 'expired'
      AND (SELECT last_outcome_class FROM public.notification_deliveries WHERE id = dl) = 'accepted'
      AND (SELECT late_result FROM public.notification_delivery_attempts WHERE delivery_id = dl),
      'late: accepted after the delivery expired never resurrects it');
  END $$;
$c$);

SELECT t.run('sweep: claim limit -> failed_dispatch; past deadline -> expired', $c$
  DO $$
  DECLARE u uuid := t.user_(); m1 record; m2 record; d1 bigint; d2 bigint;
  BEGIN
    PERFORM t.register(u, gen_random_uuid(), 'ExponentPushToken[sweep-1]');
    SELECT * INTO m1 FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    SELECT * INTO m2 FROM t.mat(u, t.render('ingest.failed', 'task'), t.push('task'));
    d1 := t.delivery_of(m1.notification_id); d2 := t.delivery_of(m2.notification_id);
    UPDATE public.notification_deliveries SET claim_count = 10 WHERE id = d1;
    UPDATE public.notification_deliveries SET send_deadline = now() - interval '1 second' WHERE id = d2;
    PERFORM public.notification_sweep(10, 1000);
    PERFORM t.check(t.status(d1) = 'failed_dispatch' AND t.status(d2) = 'expired'
      AND (SELECT last_outcome_code FROM public.notification_deliveries WHERE id = d1) = 'claim_limit_exhausted',
      'sweep: claim limit -> failed_dispatch; past deadline -> expired');
  END $$;
$c$);

-- ===========================================================================
-- Receipts
-- ===========================================================================

CREATE FUNCTION t.accepted_attempt(p_user uuid, p_token text, p_category text DEFAULT 'task')
RETURNS TABLE (delivery bigint, attempt_id bigint, registration bigint) LANGUAGE plpgsql AS $$
DECLARE m record; b record; dl bigint; r bigint;
BEGIN
  r := t.register(p_user, gen_random_uuid(), p_token);
  SELECT * INTO m FROM t.mat(p_user, t.render('ingest.failed', p_category), t.push(p_category));
  dl := t.delivery_of(m.notification_id);
  SELECT * INTO b FROM t.begin(dl);
  PERFORM t.result(b.token, dl, b.attempt, 'accepted', 'ok', 'ticket-' || dl);
  UPDATE public.notification_delivery_attempts SET receipt_available_at = now() - interval '1 second'
   WHERE delivery_id = dl AND receipt_status = 'pending';
  RETURN QUERY SELECT dl, (SELECT id FROM public.notification_delivery_attempts WHERE delivery_id = dl), r;
END $$;

CREATE FUNCTION t.claim_receipt(p_attempt bigint) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  UPDATE public.notification_delivery_attempts SET receipt_available_at = receipt_available_at + interval '100 years'
   WHERE receipt_status = 'pending' AND id <> p_attempt;
  SELECT c.receipt_token INTO v FROM public.notification_claim_receipts('expo', 1000, 120) c LIMIT 1;
  UPDATE public.notification_delivery_attempts SET receipt_available_at = receipt_available_at - interval '100 years'
   WHERE receipt_status = 'pending' AND id <> p_attempt;
  RETURN v;
END $$;

SELECT t.run('receipt: ok -> handoff_succeeded; wrong receipt token is a no-op', $c$
  DO $$
  DECLARE u uuid := t.user_(); x record; tok uuid;
  BEGIN
    SELECT * INTO x FROM t.accepted_attempt(u, 'ExponentPushToken[rcpt-ok]');
    tok := t.claim_receipt(x.attempt_id);
    PERFORM public.notification_record_receipts(gen_random_uuid(), jsonb_build_array(jsonb_build_object(
      'attempt_id', x.attempt_id, 'found', true, 'outcome_class', 'accepted', 'outcome_code', 'ok')));
    PERFORM t.check(t.status(x.delivery) = 'provider_accepted', 'receipt: a foreign receipt token changes nothing');
    PERFORM public.notification_record_receipts(tok, jsonb_build_array(jsonb_build_object(
      'attempt_id', x.attempt_id, 'found', true, 'outcome_class', 'accepted', 'outcome_code', 'ok')));
    PERFORM t.check(t.status(x.delivery) = 'handoff_succeeded'
      AND (SELECT receipt_status FROM public.notification_delivery_attempts WHERE id = x.attempt_id) = 'ok',
      'receipt: ok -> handoff_succeeded; wrong receipt token is a no-op');
  END $$;
$c$);

SELECT t.run('receipt: DeviceNotRegistered -> failed_permanent and registration deactivated', $c$
  DO $$
  DECLARE u uuid := t.user_(); x record; tok uuid;
  BEGIN
    SELECT * INTO x FROM t.accepted_attempt(u, 'ExponentPushToken[rcpt-dnr]');
    tok := t.claim_receipt(x.attempt_id);
    PERFORM public.notification_record_receipts(tok, jsonb_build_array(jsonb_build_object(
      'attempt_id', x.attempt_id, 'found', true, 'outcome_class', 'permanent_token', 'outcome_code', 'device_unregistered',
      'provider_code', 'DeviceNotRegistered')));
    PERFORM t.check(t.status(x.delivery) = 'failed_permanent'
      AND (SELECT invalid_reason FROM public.push_registrations WHERE id = x.registration) = 'device_not_registered',
      'receipt: DeviceNotRegistered -> failed_permanent and registration deactivated');
  END $$;
$c$);

SELECT t.run('receipt: MessageRateExceeded -> retry_scheduled with a new attempt allowed', $c$
  DO $$
  DECLARE u uuid := t.user_(); x record; tok uuid;
  BEGIN
    SELECT * INTO x FROM t.accepted_attempt(u, 'ExponentPushToken[rcpt-rate]');
    tok := t.claim_receipt(x.attempt_id);
    PERFORM public.notification_record_receipts(tok, jsonb_build_array(jsonb_build_object(
      'attempt_id', x.attempt_id, 'found', true, 'outcome_class', 'retryable', 'outcome_code', 'device_rate_limited',
      'retry_after_ms', 60000)));
    PERFORM t.check(t.status(x.delivery) = 'retry_scheduled', 'receipt: MessageRateExceeded -> retry_scheduled with a new attempt allowed');
  END $$;
$c$);

SELECT t.run('receipt: missing before deadline waits with backoff; after deadline -> receipt_unavailable', $c$
  DO $$
  DECLARE u uuid := t.user_(); x record; tok uuid; v_next timestamptz;
  BEGIN
    SELECT * INTO x FROM t.accepted_attempt(u, 'ExponentPushToken[rcpt-miss]');
    tok := t.claim_receipt(x.attempt_id);
    PERFORM public.notification_record_receipts(tok, jsonb_build_array(jsonb_build_object('attempt_id', x.attempt_id, 'found', false)));
    SELECT receipt_available_at INTO v_next FROM public.notification_delivery_attempts WHERE id = x.attempt_id;
    PERFORM t.check(t.status(x.delivery) = 'provider_accepted' AND v_next > now() + interval '14 minutes',
      'receipt: missing before the deadline is polled again later');
    UPDATE public.notification_delivery_attempts SET receipt_available_at = now() - interval '1 second',
      receipt_deadline = now() - interval '1 second' WHERE id = x.attempt_id;
    tok := t.claim_receipt(x.attempt_id);
    PERFORM public.notification_record_receipts(tok, jsonb_build_array(jsonb_build_object('attempt_id', x.attempt_id, 'found', false)));
    PERFORM t.check(t.status(x.delivery) = 'receipt_unavailable'
      AND (SELECT receipt_status FROM public.notification_delivery_attempts WHERE id = x.attempt_id) = 'unavailable',
      'receipt: missing before deadline waits with backoff; after deadline -> receipt_unavailable');
  END $$;
$c$);

-- ===========================================================================
-- Registration, account switch, sign-out, open tracking
-- ===========================================================================

SELECT t.run('register: fingerprint stored, token never needed to log', $c$
  DO $$
  DECLARE u uuid := t.user_(); r bigint;
  BEGIN
    r := t.register(u, gen_random_uuid(), 'ExponentPushToken[fp-1]');
    PERFORM t.check((SELECT char_length(token_fingerprint) FROM public.push_registrations WHERE id = r) = 16,
      'register: fingerprint stored, token never needed to log');
  END $$;
$c$);

SELECT t.run('register: account switch with the device token reassigns and suppresses old user deliveries', $c$
  DO $$
  DECLARE a uuid := t.user_(); b uuid := t.user_(); inst uuid := gen_random_uuid(); m record; dl bigint; r record;
  BEGIN
    PERFORM t.register(a, inst, 'ExponentPushToken[switch-1]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    SELECT * INTO r FROM public.notification_register_push(b, inst, 'expo', 'ExponentPushToken[switch-1]', 'ios',
      NULL, NULL, NULL, NULL, 'granted', NULL);
    PERFORM t.check(r.previous_user_id = a
      AND (SELECT user_id FROM public.push_registrations WHERE installation_id = inst) = b
      AND t.status(dl) = 'suppressed'
      AND (SELECT suppressed_reason FROM public.notification_deliveries WHERE id = dl) = 'installation_reassigned',
      'register: account switch with the device token reassigns and suppresses old user deliveries');
  END $$;
$c$);

SELECT t.run('register: takeover with a different token while bound to another user -> PT409', $c$
  DO $$
  DECLARE a uuid := t.user_(); b uuid := t.user_(); inst uuid := gen_random_uuid();
  BEGIN
    PERFORM t.register(a, inst, 'ExponentPushToken[take-1]');
    BEGIN
      PERFORM t.register(b, inst, 'ExponentPushToken[take-2]');
      PERFORM t.check(false, 'register: takeover with a different token while bound to another user -> PT409');
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      PERFORM t.check((SELECT user_id FROM public.push_registrations WHERE installation_id = inst) = a,
        'register: takeover with a different token while bound to another user -> PT409');
    END;
  END $$;
$c$);

SELECT t.run('register: unbound installation can be claimed by the next user', $c$
  DO $$
  DECLARE a uuid := t.user_(); b uuid := t.user_(); inst uuid := gen_random_uuid();
  BEGIN
    PERFORM t.register(a, inst, 'ExponentPushToken[unb-1]');
    PERFORM public.notification_unregister_installation(a, inst);
    PERFORM t.register(b, inst, 'ExponentPushToken[unb-2]');
    PERFORM t.check((SELECT user_id FROM public.push_registrations WHERE installation_id = inst) = b,
      'register: unbound installation can be claimed by the next user');
  END $$;
$c$);

SELECT t.run('register: token moved to a new installation removes the stale row and its deliveries', $c$
  DO $$
  DECLARE a uuid := t.user_(); i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); m record; dl bigint;
  BEGIN
    PERFORM t.register(a, i1, 'ExponentPushToken[move-1]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    PERFORM t.register(a, i2, 'ExponentPushToken[move-1]');
    PERFORM t.check(NOT EXISTS (SELECT 1 FROM public.push_registrations WHERE installation_id = i1)
      AND EXISTS (SELECT 1 FROM public.push_registrations WHERE installation_id = i2)
      AND t.status(dl) = 'suppressed',
      'register: token moved to a new installation removes the stale row and its deliveries');
  END $$;
$c$);

SELECT t.run('register: re-registering clears a DeviceNotRegistered invalidation', $c$
  DO $$
  DECLARE a uuid := t.user_(); inst uuid := gen_random_uuid(); r bigint;
  BEGIN
    r := t.register(a, inst, 'ExponentPushToken[rereg-1]');
    UPDATE public.push_registrations SET invalidated_at = now(), invalid_reason = 'device_not_registered' WHERE id = r;
    PERFORM t.register(a, inst, 'ExponentPushToken[rereg-1]');
    PERFORM t.check((SELECT invalidated_at FROM public.push_registrations WHERE id = r) IS NULL,
      'register: re-registering clears a DeviceNotRegistered invalidation');
  END $$;
$c$);

SELECT t.run('unregister: only the owner detaches; open deliveries suppressed as signed out', $c$
  DO $$
  DECLARE a uuid := t.user_(); other uuid := t.user_(); inst uuid := gen_random_uuid(); m record; dl bigint; v_other int; v_own int;
  BEGIN
    PERFORM t.register(a, inst, 'ExponentPushToken[out-1]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    v_other := public.notification_unregister_installation(other, inst);
    v_own := public.notification_unregister_installation(a, inst);
    PERFORM t.check(v_other = 0 AND v_own = 1
      AND (SELECT user_id FROM public.push_registrations WHERE installation_id = inst) IS NULL
      AND (SELECT suppressed_reason FROM public.notification_deliveries WHERE id = dl) = 'installation_signed_out',
      'unregister: only the owner detaches; open deliveries suppressed as signed out');
  END $$;
$c$);

SELECT t.run('send: delivery for a signed-out installation is suppressed at begin', $c$
  DO $$
  DECLARE a uuid := t.user_(); inst uuid := gen_random_uuid(); m record; dl bigint; b record;
  BEGIN
    PERFORM t.register(a, inst, 'ExponentPushToken[out-2]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    UPDATE public.push_registrations SET user_id = NULL WHERE installation_id = inst;
    SELECT * INTO b FROM t.begin(dl);
    PERFORM t.check(b.rows_begun = 0
      AND (SELECT suppressed_reason FROM public.notification_deliveries WHERE id = dl) = 'installation_signed_out',
      'send: delivery for a signed-out installation is suppressed at begin');
  END $$;
$c$);

SELECT t.run('open: push open checks ownership of notification and delivery, then marks read', $c$
  DO $$
  DECLARE a uuid := t.user_(); other uuid := t.user_(); m record; dl bigint; v_other boolean; v_own boolean;
  BEGIN
    PERFORM t.register(a, gen_random_uuid(), 'ExponentPushToken[open-1]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    v_other := public.notification_record_push_open(other, m.notification_id, dl, NULL);
    v_own := public.notification_record_push_open(a, m.notification_id, dl, 'open');
    PERFORM t.check(NOT v_other AND v_own
      AND (SELECT opened_at FROM public.notification_deliveries WHERE id = dl) IS NOT NULL
      AND (SELECT read_at FROM public.notifications WHERE id = m.notification_id) IS NOT NULL,
      'open: push open checks ownership of notification and delivery, then marks read');
  END $$;
$c$);

-- ===========================================================================
-- Retention, purge, health
-- ===========================================================================

SELECT t.run('prune: deliveries (with attempts) and dead registrations go after 30 days', $c$
  DO $$
  DECLARE a uuid := t.user_(); m record; dl bigint; inst uuid := gen_random_uuid(); r jsonb;
  BEGIN
    PERFORM t.register(a, inst, 'ExponentPushToken[prune-1]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    PERFORM t.begin(dl);
    UPDATE public.notification_deliveries SET created_at = now() - interval '31 days' WHERE id = dl;
    PERFORM public.notification_unregister_installation(a, inst);
    UPDATE public.push_registrations SET updated_at = now() - interval '31 days' WHERE installation_id = inst;
    r := public.notification_prune(5000, 7, 30, 120, 30, 90, 30);
    PERFORM t.check(NOT EXISTS (SELECT 1 FROM public.notification_deliveries WHERE id = dl)
      AND NOT EXISTS (SELECT 1 FROM public.notification_delivery_attempts WHERE delivery_id = dl)
      AND NOT EXISTS (SELECT 1 FROM public.push_registrations WHERE installation_id = inst)
      AND EXISTS (SELECT 1 FROM public.notifications WHERE id = m.notification_id),
      'prune: deliveries (with attempts) and dead registrations go after 30 days', r::text);
  END $$;
$c$);

SELECT t.run('purge: deletes registrations, deliveries and inbox; stays purged', $c$
  DO $$
  DECLARE a uuid := t.user_(); m record; dl bigint; r jsonb;
  BEGIN
    PERFORM t.register(a, gen_random_uuid(), 'ExponentPushToken[purge-1]');
    SELECT * INTO m FROM t.mat(a, t.render('ingest.failed', 'task'), t.push('task'));
    dl := t.delivery_of(m.notification_id);
    r := public.notification_purge_user(a, 1000);
    PERFORM t.check((r->>'done')::boolean
      AND NOT EXISTS (SELECT 1 FROM public.push_registrations WHERE user_id = a)
      AND NOT EXISTS (SELECT 1 FROM public.notification_deliveries WHERE id = dl)
      AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a)
      AND (public.notification_purge_user(a, 1000)->>'done')::boolean,
      'purge: deletes registrations, deliveries and inbox; stays purged', r::text);
  END $$;
$c$);

SELECT t.run('purge: actor removal still recomputes aggregates (Phase 1 behaviour)', $c$
  DO $$
  DECLARE u uuid := t.user_(); a1 uuid := t.user_(); a2 uuid := t.user_(); m record;
  BEGIN
    SELECT * INTO m FROM t.mat(u, t.render('creator.followed', 'social', 'pa-' || u, true), NULL, a1);
    PERFORM t.mat(u, t.render('creator.followed', 'social', 'pa-' || u, true), NULL, a2);
    PERFORM public.notification_purge_user(a1, 1000);
    PERFORM t.check((SELECT actor_count FROM public.notifications WHERE id = m.notification_id) = 1
      AND (SELECT sample_actor_ids FROM public.notifications WHERE id = m.notification_id) = ARRAY[a2],
      'purge: actor removal still recomputes aggregates (Phase 1 behaviour)');
  END $$;
$c$);

SELECT t.run('health: snapshot keeps Phase 1 keys and adds push lag counters', $c$
  SELECT t.check(
    (SELECT s ? 'outbox_oldest_due_created_at' AND s ? 'outbox_due_count_capped' AND s ? 'outbox_dead_count_capped'
       AND s ? 'push_oldest_due_available_at' AND s ? 'push_stuck_sending_count_capped'
       AND s ? 'push_receipts_overdue_count_capped'
     FROM public.notification_health_snapshot() s),
    'health: snapshot keeps Phase 1 keys and adds push lag counters');
$c$);
