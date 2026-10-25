-- Notifications Phase 4: push registrations, deliveries, attempts and push RPCs.
-- Additive over 20261012120000_notifications_inbox.sql. Push stays inert until the worker passes
-- p_push to notification_materialize (NOTIFICATIONS_PUSH_ENABLED=true); with p_push NULL the
-- Phase 1 inbox behaviour is unchanged. All access is service-role only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per installation per provider. token_fingerprint is the only token form ever logged.
CREATE TABLE IF NOT EXISTS public.push_registrations (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id    uuid        NOT NULL,
  provider           text        NOT NULL CHECK (provider IN ('expo', 'apns', 'fcm')),
  token              text        NOT NULL CHECK (char_length(token) BETWEEN 1 AND 512),
  token_fingerprint  text        NOT NULL CHECK (char_length(token_fingerprint) = 16),
  user_id            uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  platform           text        NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version        text        CHECK (char_length(app_version) <= 40),
  app_build          text        CHECK (char_length(app_build) <= 40),
  locale             text        CHECK (char_length(locale) <= 35),
  timezone           text        CHECK (char_length(timezone) <= 64),
  os_permission      text        NOT NULL CHECK (os_permission IN ('granted', 'provisional', 'denied', 'undetermined')),
  apns_environment   text        CHECK (apns_environment IN ('sandbox', 'production')),
  user_bound_at      timestamptz,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at     timestamptz,
  invalid_reason     text        CHECK (invalid_reason IN ('device_not_registered', 'provider_rejected')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_registrations_installation_provider_uq UNIQUE (installation_id, provider),
  CONSTRAINT push_registrations_provider_token_uq        UNIQUE (provider, token),
  CONSTRAINT push_registrations_invalid_chk CHECK ((invalidated_at IS NULL) = (invalid_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS push_registrations_user_active_idx ON public.push_registrations (user_id)
  WHERE user_id IS NOT NULL AND invalidated_at IS NULL AND os_permission IN ('granted', 'provisional');
CREATE INDEX IF NOT EXISTS push_registrations_user_idx ON public.push_registrations (user_id);
CREATE INDEX IF NOT EXISTS push_registrations_prune_idx ON public.push_registrations (updated_at)
  WHERE user_id IS NULL OR invalidated_at IS NOT NULL;

-- One per notification per installation per channel.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id    uuid        NOT NULL REFERENCES public.notifications (id) ON DELETE CASCADE,
  recipient_user_id  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  installation_id    uuid        NOT NULL,
  registration_id    bigint      REFERENCES public.push_registrations (id) ON DELETE SET NULL,
  provider           text        NOT NULL CHECK (provider IN ('expo', 'apns', 'fcm')),
  channel            text        NOT NULL DEFAULT 'push' CHECK (channel IN ('push')),
  category           text        NOT NULL CHECK (category IN ('social', 'task', 'account', 'security', 'promo')),
  retry_policy       text        NOT NULL CHECK (retry_policy IN ('retry_ambiguous_once', 'no_ambiguous_retry')),
  status             text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'dispatching', 'sending', 'retry_scheduled',
                       'provider_accepted', 'handoff_succeeded', 'suppressed', 'failed_permanent',
                       'failed_exhausted', 'failed_ambiguous', 'failed_dispatch', 'expired',
                       'receipt_unavailable')),
  available_at       timestamptz NOT NULL DEFAULT now(),
  send_deadline      timestamptz NOT NULL,
  lease_token        uuid,
  lease_until        timestamptz,
  claim_count        int         NOT NULL DEFAULT 0,
  send_attempt       int         NOT NULL DEFAULT 0,
  max_send_attempts  int         NOT NULL DEFAULT 3 CHECK (max_send_attempts BETWEEN 1 AND 10),
  ambiguous_count    int         NOT NULL DEFAULT 0,
  last_outcome_class text,
  last_outcome_code  text,
  suppressed_reason  text        CHECK (suppressed_reason IN ('registration_invalid', 'installation_reassigned',
                                   'installation_signed_out', 'permission_denied', 'preference_changed',
                                   'recipient_unavailable', 'actor_unavailable')),
  opened_at          timestamptz,
  acted_at           timestamptz,
  opened_action      text        CHECK (char_length(opened_action) <= 40),
  terminal_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_uq UNIQUE (notification_id, installation_id, channel),
  CONSTRAINT notification_deliveries_lease_chk
    CHECK ((status IN ('dispatching', 'sending')) = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CONSTRAINT notification_deliveries_suppressed_chk
    CHECK ((status = 'suppressed') = (suppressed_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx ON public.notification_deliveries (provider, available_at, id)
  WHERE status IN ('pending', 'retry_scheduled', 'dispatching');
CREATE INDEX IF NOT EXISTS notification_deliveries_deadline_idx ON public.notification_deliveries (send_deadline)
  WHERE status IN ('pending', 'retry_scheduled', 'dispatching');
CREATE INDEX IF NOT EXISTS notification_deliveries_sending_idx ON public.notification_deliveries (lease_until)
  WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS notification_deliveries_open_by_installation_idx
  ON public.notification_deliveries (installation_id)
  WHERE status IN ('pending', 'retry_scheduled', 'dispatching', 'sending');
CREATE INDEX IF NOT EXISTS notification_deliveries_recipient_idx ON public.notification_deliveries (recipient_user_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_registration_idx ON public.notification_deliveries (registration_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_prune_idx ON public.notification_deliveries (created_at);

-- Immutable facts per provider call. outcome_*/finished_at are written only from a real provider
-- result; abandoned_at only by the sweeper. late_result marks that both happened.
CREATE TABLE IF NOT EXISTS public.notification_delivery_attempts (
  id                       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id              bigint      NOT NULL REFERENCES public.notification_deliveries (id) ON DELETE CASCADE,
  attempt_no               int         NOT NULL,
  dispatch_token           uuid        NOT NULL,
  provider                 text        NOT NULL,
  registration_id          bigint,
  token_fingerprint        text        NOT NULL,
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  latency_ms               int,
  abandoned_at             timestamptz,
  abandon_reason           text        CHECK (abandon_reason IN ('worker_lost')),
  late_result              boolean     NOT NULL DEFAULT false,
  outcome_class            text        CHECK (outcome_class IN ('accepted', 'retryable', 'ambiguous',
                                         'permanent_token', 'permanent_message', 'provider_config')),
  outcome_code             text        CHECK (char_length(outcome_code) <= 60),
  provider_code            text        CHECK (char_length(provider_code) <= 120),
  provider_message         text        CHECK (char_length(provider_message) <= 500),
  http_status              int,
  retry_after_ms           int,
  provider_message_id      text        CHECK (char_length(provider_message_id) <= 200),
  receipt_status           text        NOT NULL DEFAULT 'not_applicable'
                           CHECK (receipt_status IN ('not_applicable', 'pending', 'ok', 'error', 'unavailable')),
  receipt_available_at     timestamptz,
  receipt_deadline         timestamptz,
  receipt_lease_token      uuid,
  receipt_checks           int         NOT NULL DEFAULT 0,
  receipt_checked_at       timestamptz,
  receipt_outcome_class    text,
  receipt_outcome_code     text,
  receipt_provider_code    text        CHECK (char_length(receipt_provider_code) <= 120),
  receipt_provider_message text        CHECK (char_length(receipt_provider_message) <= 500),
  CONSTRAINT notification_delivery_attempts_uq UNIQUE (delivery_id, attempt_no),
  CONSTRAINT notification_delivery_attempts_abandon_chk CHECK ((abandoned_at IS NULL) = (abandon_reason IS NULL)),
  CONSTRAINT notification_delivery_attempts_late_chk
    CHECK (NOT late_result OR (abandoned_at IS NOT NULL AND finished_at IS NOT NULL)),
  CONSTRAINT notification_delivery_attempts_receipt_chk
    CHECK (receipt_status <> 'pending' OR (receipt_available_at IS NOT NULL AND receipt_deadline IS NOT NULL
                                           AND provider_message_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS notification_attempts_receipt_due_idx
  ON public.notification_delivery_attempts (provider, receipt_available_at, id) WHERE receipt_status = 'pending';
CREATE INDEX IF NOT EXISTS notification_attempts_prune_idx ON public.notification_delivery_attempts (started_at);

ALTER TABLE public.push_registrations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.push_registrations,
  public.notification_deliveries,
  public.notification_delivery_attempts
FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_token_fingerprint(p_token text)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT left(encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), 16);
$$;

-- Backoff for known-retryable outcomes: 30 s, 2 m, 8 m with ±20% jitter.
CREATE OR REPLACE FUNCTION public.notification_push_backoff(p_attempt int)
RETURNS interval
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
  SELECT make_interval(secs => (ARRAY[30, 120, 480])[LEAST(GREATEST(p_attempt, 1), 3)] * (0.8 + random() * 0.4));
$$;

-- Missing-receipt polling: 15 m, 30 m, 1 h, 2 h, 4 h, then 8 h.
CREATE OR REPLACE FUNCTION public.notification_receipt_backoff(p_checks int)
RETURNS interval
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT make_interval(mins => (ARRAY[15, 30, 60, 120, 240, 480])[LEAST(GREATEST(p_checks, 1), 6)]);
$$;

CREATE OR REPLACE FUNCTION public.notification_push_is_terminal(p_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT p_status IN ('handoff_succeeded', 'suppressed', 'failed_permanent', 'failed_exhausted',
                      'failed_ambiguous', 'failed_dispatch', 'expired', 'receipt_unavailable');
$$;

-- Suppresses open deliveries on an installation, optionally keeping one recipient's rows.
CREATE OR REPLACE FUNCTION public.notification_suppress_installation_deliveries(
  p_installation_id uuid, p_reason text, p_keep_recipient uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.notification_deliveries d
     SET status = 'suppressed', suppressed_reason = p_reason, lease_token = NULL, lease_until = NULL,
         terminal_at = now(), updated_at = now()
   WHERE d.installation_id = p_installation_id
     AND d.status IN ('pending', 'retry_scheduled', 'dispatching', 'sending')
     AND (p_keep_recipient IS NULL OR d.recipient_user_id <> p_keep_recipient);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Fingerprint-matched, so a late result for a rotated token never kills the new one.
CREATE OR REPLACE FUNCTION public.notification_invalidate_registration(
  p_registration_id bigint, p_token_fingerprint text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_registration_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.push_registrations r
     SET invalidated_at = now(), invalid_reason = p_reason, updated_at = now()
   WHERE r.id = p_registration_id AND r.token_fingerprint = p_token_fingerprint AND r.invalidated_at IS NULL;
  RETURN FOUND;
END;
$$;

-- Applies section 5.2 of the plan to one delivery row (already locked by the caller).
-- p_late: the result belongs to the current attempt but arrived after the sweeper abandoned it.
CREATE OR REPLACE FUNCTION public.notification_apply_push_outcome(
  p_delivery_id bigint, p_class text, p_code text, p_retry_after_ms int, p_late boolean, p_from_receipt boolean)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  d       public.notification_deliveries%ROWTYPE;
  v_next  timestamptz;
  v_status text;
  v_amb   int;
BEGIN
  SELECT * INTO d FROM public.notification_deliveries dl WHERE dl.id = p_delivery_id;
  v_status := d.status;
  v_amb    := d.ambiguous_count;
  v_next   := NULL;

  IF p_class = 'accepted' THEN
    IF p_from_receipt OR d.provider <> 'expo' THEN
      v_status := 'handoff_succeeded';
    ELSE
      v_status := 'provider_accepted';
    END IF;
    IF p_late AND d.last_outcome_code = 'worker_lost' AND d.ambiguous_count > 0 AND d.status = 'retry_scheduled' THEN
      v_amb := d.ambiguous_count - 1;
    END IF;

  ELSIF p_class IN ('permanent_token', 'permanent_message') THEN
    v_status := 'failed_permanent';

  ELSIF p_class = 'retryable' THEN
    v_next := now() + GREATEST(public.notification_push_backoff(d.send_attempt),
                               make_interval(secs => COALESCE(p_retry_after_ms, 0) / 1000.0));
    IF p_late AND d.status = 'retry_scheduled' THEN
      v_next := NULL;
    ELSIF d.send_attempt < d.max_send_attempts AND v_next < d.send_deadline THEN
      v_status := 'retry_scheduled';
    ELSIF p_late THEN
      v_next := NULL;
    ELSIF now() >= d.send_deadline THEN
      v_status := 'expired'; v_next := NULL;
    ELSE
      v_status := 'failed_exhausted'; v_next := NULL;
    END IF;

  ELSIF p_class = 'provider_config' THEN
    -- Not bounded by max_send_attempts; the deadline bounds it.
    v_next := now() + interval '5 minutes';
    IF p_late AND d.status = 'retry_scheduled' THEN
      v_next := NULL;
    ELSIF v_next < d.send_deadline THEN
      v_status := 'retry_scheduled';
    ELSIF p_late THEN
      v_next := NULL;
    ELSE
      v_status := 'expired'; v_next := NULL;
    END IF;

  ELSIF p_class = 'ambiguous' THEN
    v_next := now() + interval '30 seconds';
    IF p_late THEN
      v_next := NULL;
    ELSIF d.retry_policy = 'retry_ambiguous_once' AND d.ambiguous_count = 0 AND v_next < d.send_deadline THEN
      v_status := 'retry_scheduled'; v_amb := d.ambiguous_count + 1;
    ELSE
      v_status := 'failed_ambiguous'; v_next := NULL;
    END IF;
  ELSE
    RAISE EXCEPTION 'notification_apply_push_outcome: unknown outcome class %', p_class USING ERRCODE = '22023';
  END IF;

  UPDATE public.notification_deliveries dl
     SET status             = v_status,
         available_at       = COALESCE(v_next, dl.available_at),
         ambiguous_count    = v_amb,
         lease_token        = NULL,
         lease_until        = NULL,
         last_outcome_class = p_class,
         last_outcome_code  = p_code,
         terminal_at        = CASE WHEN public.notification_push_is_terminal(v_status)
                                   THEN COALESCE(dl.terminal_at, now()) ELSE NULL END,
         updated_at         = now()
   WHERE dl.id = p_delivery_id;
  RETURN v_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- Materialize with push decision (replaces the Phase 1 three-argument version)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.notification_materialize(bigint, uuid, jsonb);

-- p_push NULL = push disabled: exactly the Phase 1 behaviour (push_decision 'not_applicable').
CREATE OR REPLACE FUNCTION public.notification_materialize(
  p_outbox_id bigint, p_lease_token uuid, p_render jsonb, p_push jsonb DEFAULT NULL)
RETURNS TABLE (outcome text, notification_id uuid, deliveries_created int)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  o                 public.notification_outbox%ROWTYPE;
  v_category        text    := p_render->>'category';
  v_group_key       text    := NULLIF(p_render->>'group_key', '');
  v_window          int     := COALESCE((p_render->>'group_window_seconds')::int, 3600);
  v_requires_actor  boolean := COALESCE((p_render->>'requires_actor')::boolean, false);
  v_expires_at      timestamptz := NULLIF(p_render->>'expires_at', '')::timestamptz;
  v_push_enabled    boolean := COALESCE((p_push->>'enabled')::boolean, false);
  v_ttl             int     := COALESCE((p_push->>'ttl_seconds')::int, 0);
  v_retry_policy    text    := COALESCE(p_push->>'retry_policy', 'no_ambiguous_retry');
  v_max_attempts    int     := COALESCE((p_push->>'max_send_attempts')::int, 3);
  v_cooldown        int     := COALESCE((p_push->>'cooldown_seconds')::int, 0);
  v_rate_cap        int     := NULLIF(p_push->>'rate_cap', '')::int;
  v_rate_window     int     := COALESCE((p_push->>'rate_window_seconds')::int, 86400);
  v_providers       text[]  := CASE WHEN jsonb_typeof(p_push->'provider_preference') = 'array'
                                 THEN ARRAY(SELECT jsonb_array_elements_text(p_push->'provider_preference'))
                                 ELSE ARRAY['expo'] END;
  v_recipient_state text;
  v_actor_state     text;
  v_inbox_on        boolean;
  v_push_channel    boolean := false;
  v_push_on         boolean := false;
  v_bucket          timestamptz;
  v_id              uuid;
  v_first           boolean := false;
  v_new_actor       int     := 0;
  v_result          text;
  v_decision        text;
  v_recent          int;
  v_tz              text;
  v_qh_start        time;
  v_qh_end          time;
  v_local           timestamp;
  v_end_local       timestamp;
  v_available       timestamptz;
  v_deadline        timestamptz;
  v_deliveries      int     := 0;
BEGIN
  SELECT * INTO o
  FROM public.notification_outbox ob
  WHERE ob.id = p_outbox_id AND ob.status = 'claimed' AND ob.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::uuid, 0;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ntf:' || o.recipient_user_id::text, 0));

  SELECT u.account_status INTO v_recipient_state FROM public.users u WHERE u.id = o.recipient_user_id;
  IF v_recipient_state IS NOT NULL AND v_recipient_state NOT IN ('CREATED', 'ACTIVE') THEN
    v_result := 'suppressed_recipient';
  ELSIF v_requires_actor THEN
    IF o.actor_user_id IS NULL THEN
      v_result := 'suppressed_actor_unavailable';
    ELSE
      SELECT u.account_status INTO v_actor_state FROM public.users u WHERE u.id = o.actor_user_id;
      IF v_actor_state IS NOT NULL AND v_actor_state NOT IN ('CREATED', 'ACTIVE') THEN
        v_result := 'suppressed_actor_unavailable';
      END IF;
    END IF;
  END IF;

  IF v_result IS NULL THEN
    v_inbox_on := public.notification_channel_enabled(o.recipient_user_id, v_category, 'inbox');
    IF p_push IS NOT NULL THEN
      v_push_channel := public.notification_channel_enabled(o.recipient_user_id, v_category, 'push');
      v_push_on := v_push_channel AND v_push_enabled;
    END IF;
    IF NOT v_inbox_on AND NOT v_push_on THEN
      v_result := 'suppressed_preference';
    END IF;
  END IF;

  IF v_result IS NULL AND v_group_key IS NULL THEN
    INSERT INTO public.notifications (
      user_id, type, category, schema_version, title, body, inbox_visible, data, deep_link,
      actor_count, event_count, sample_actor_ids, last_actor_user_id, sort_at, expires_at)
    VALUES (
      o.recipient_user_id, p_render->>'type', v_category, o.schema_version,
      p_render->>'title', p_render->>'body', v_inbox_on,
      COALESCE(p_render->'data', '{}'::jsonb), NULLIF(p_render->>'deep_link', ''),
      CASE WHEN o.actor_user_id IS NULL THEN 0 ELSE 1 END, 1,
      CASE WHEN o.actor_user_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[o.actor_user_id] END,
      o.actor_user_id, now(), v_expires_at)
    RETURNING id INTO v_id;

    IF o.actor_user_id IS NOT NULL THEN
      INSERT INTO public.notification_group_actors (notification_id, actor_user_id, first_outbox_id)
      VALUES (v_id, o.actor_user_id, o.id);
    END IF;
    v_first := true;
    v_result := 'created';

  ELSIF v_result IS NULL THEN
    v_bucket := date_bin(make_interval(secs => v_window), o.occurred_at, timestamptz '2000-01-01 00:00:00+00');

    INSERT INTO public.notifications (
      user_id, type, category, schema_version, title, body, inbox_visible, data, deep_link,
      group_key, group_bucket, actor_count, event_count, sample_actor_ids, sort_at, expires_at)
    VALUES (
      o.recipient_user_id, p_render->>'type', v_category, o.schema_version,
      p_render->>'title', p_render->>'body', v_inbox_on,
      COALESCE(p_render->'data', '{}'::jsonb), NULLIF(p_render->>'deep_link', ''),
      v_group_key, v_bucket, 0, 0, '{}'::uuid[], now(), v_expires_at)
    ON CONFLICT (user_id, group_key, group_bucket) WHERE group_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      v_first := true;
    ELSE
      SELECT n.id INTO v_id
      FROM public.notifications n
      WHERE n.user_id = o.recipient_user_id AND n.group_key = v_group_key AND n.group_bucket = v_bucket
      FOR UPDATE;
    END IF;

    IF o.actor_user_id IS NOT NULL THEN
      INSERT INTO public.notification_group_actors (notification_id, actor_user_id, first_outbox_id)
      VALUES (v_id, o.actor_user_id, o.id)
      ON CONFLICT (notification_id, actor_user_id) DO NOTHING;
      GET DIAGNOSTICS v_new_actor = ROW_COUNT;
    END IF;

    UPDATE public.notifications n
       SET event_count        = n.event_count + 1,
           actor_count        = n.actor_count + v_new_actor,
           sample_actor_ids   = CASE
                                  WHEN v_new_actor = 1 AND cardinality(n.sample_actor_ids) < 3
                                    THEN n.sample_actor_ids || o.actor_user_id
                                  ELSE n.sample_actor_ids
                                END,
           last_actor_user_id = COALESCE(o.actor_user_id, n.last_actor_user_id),
           inbox_visible      = n.inbox_visible OR v_inbox_on,
           read_at            = CASE WHEN v_new_actor = 1 AND NOT v_first THEN NULL ELSE n.read_at END,
           seen_at            = CASE WHEN v_new_actor = 1 AND NOT v_first THEN NULL ELSE n.seen_at END,
           sort_at            = CASE WHEN v_new_actor = 1 AND NOT v_first THEN now() ELSE n.sort_at END,
           updated_at         = now()
     WHERE n.id = v_id;

    v_result := CASE WHEN v_first THEN 'created' ELSE 'aggregated' END;
  END IF;

  -- Push decision: first event of a notification only. Caps and cooldown change push_decision
  -- only; the inbox row above is always kept.
  IF v_first AND p_push IS NOT NULL THEN
    IF NOT v_push_enabled THEN
      v_decision := 'suppressed_kill_switch';
    ELSIF NOT v_push_channel THEN
      v_decision := 'suppressed_preference';
    END IF;

    IF v_decision IS NULL AND v_group_key IS NOT NULL AND v_cooldown > 0 AND EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = o.recipient_user_id AND n.group_key = v_group_key AND n.id <> v_id
        AND n.push_decision = 'queued' AND n.created_at > now() - make_interval(secs => v_cooldown))
    THEN
      v_decision := 'suppressed_cooldown';
    END IF;

    IF v_decision IS NULL AND v_rate_cap IS NOT NULL THEN
      SELECT count(*)::int INTO v_recent FROM (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = o.recipient_user_id AND n.category = v_category AND n.push_decision = 'queued'
          AND n.created_at > now() - make_interval(secs => v_rate_window)
        LIMIT v_rate_cap) recent;
      IF v_recent >= v_rate_cap THEN
        v_decision := 'suppressed_rate_limit';
      END IF;
    END IF;

    IF v_decision IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.push_registrations r
      WHERE r.user_id = o.recipient_user_id AND r.invalidated_at IS NULL
        AND r.os_permission IN ('granted', 'provisional') AND r.provider = ANY (v_providers))
    THEN
      v_decision := 'no_registrations';
    END IF;

    IF v_decision IS NULL THEN
      v_available := now();
      v_deadline  := now() + make_interval(secs => GREATEST(v_ttl, 60));
      SELECT s.timezone, s.quiet_hours_start, s.quiet_hours_end INTO v_tz, v_qh_start, v_qh_end
      FROM public.user_notification_settings s WHERE s.user_id = o.recipient_user_id;
      IF v_category <> 'security' AND v_qh_start IS NOT NULL AND v_qh_start <> v_qh_end THEN
        BEGIN
          v_local := now() AT TIME ZONE COALESCE(v_tz, 'UTC');
          IF (v_qh_start < v_qh_end AND v_local::time >= v_qh_start AND v_local::time < v_qh_end)
             OR (v_qh_start > v_qh_end AND (v_local::time >= v_qh_start OR v_local::time < v_qh_end)) THEN
            v_end_local := date_trunc('day', v_local) + v_qh_end;
            IF v_end_local <= v_local THEN
              v_end_local := v_end_local + interval '1 day';
            END IF;
            v_available := v_end_local AT TIME ZONE COALESCE(v_tz, 'UTC');
          END IF;
        EXCEPTION WHEN invalid_parameter_value THEN
          v_available := now();
        END;
      END IF;

      IF v_available >= v_deadline THEN
        v_decision := 'suppressed_quiet_hours';
      ELSE
        INSERT INTO public.notification_deliveries (
          notification_id, recipient_user_id, installation_id, registration_id, provider, category,
          retry_policy, available_at, send_deadline, max_send_attempts)
        SELECT DISTINCT ON (r.installation_id)
               v_id, o.recipient_user_id, r.installation_id, r.id, r.provider, v_category,
               v_retry_policy, v_available, v_deadline, v_max_attempts
        FROM public.push_registrations r
        WHERE r.user_id = o.recipient_user_id AND r.invalidated_at IS NULL
          AND r.os_permission IN ('granted', 'provisional') AND r.provider = ANY (v_providers)
        ORDER BY r.installation_id, array_position(v_providers, r.provider)
        ON CONFLICT (notification_id, installation_id, channel) DO NOTHING;
        GET DIAGNOSTICS v_deliveries = ROW_COUNT;
        v_decision := CASE WHEN v_deliveries > 0 THEN 'queued' ELSE 'no_registrations' END;
      END IF;
    END IF;

    UPDATE public.notifications n SET push_decision = v_decision, updated_at = now() WHERE n.id = v_id;
  END IF;

  UPDATE public.notification_outbox ob
     SET status          = 'processed',
         result          = v_result,
         notification_id = v_id,
         processed_at    = now(),
         lease_token     = NULL,
         lease_until     = NULL
   WHERE ob.id = o.id;

  RETURN QUERY SELECT v_result, v_id, v_deliveries;
END;
$$;

-- ---------------------------------------------------------------------------
-- Dispatch: claim, begin send, record results
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_claim_push_deliveries(
  p_provider text, p_batch int, p_lease_seconds int, p_max_claims int)
RETURNS TABLE (dispatch_token uuid, delivery_id bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_token uuid        := gen_random_uuid();
  v_until timestamptz := now() + make_interval(secs => p_lease_seconds);
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT d.id
    FROM public.notification_deliveries d
    WHERE d.provider = p_provider
      AND d.status IN ('pending', 'retry_scheduled', 'dispatching')
      AND d.available_at <= now()
      AND d.send_deadline > now()
      AND d.claim_count < p_max_claims
    ORDER BY d.available_at, d.id
    LIMIT LEAST(GREATEST(p_batch, 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_deliveries d
     SET status = 'dispatching', lease_token = v_token, lease_until = v_until,
         available_at = v_until, claim_count = d.claim_count + 1, updated_at = now()
    FROM eligible e
   WHERE d.id = e.id
  RETURNING v_token, d.id;
END;
$$;

-- Re-validates every claimed row, then flips it to 'sending' and opens an attempt. Tokens are
-- read only here and never leave the worker process.
CREATE OR REPLACE FUNCTION public.notification_begin_push_send(p_dispatch_token uuid, p_send_lease_seconds int)
RETURNS TABLE (delivery_id bigint, attempt_no int, provider text, token text, token_fingerprint text,
               platform text, notification_id uuid, type text, category text, title text, body text,
               deep_link text, data jsonb, group_key text, actor_count int, sample_actor_ids uuid[],
               send_deadline timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  d        public.notification_deliveries%ROWTYPE;
  r        public.push_registrations%ROWTYPE;
  n        public.notifications%ROWTYPE;
  v_state  text;
  v_reason text;
  v_until  timestamptz := now() + make_interval(secs => p_send_lease_seconds);
BEGIN
  FOR d IN
    SELECT * FROM public.notification_deliveries dl
    WHERE dl.lease_token = p_dispatch_token AND dl.status = 'dispatching'
    ORDER BY dl.id
    FOR UPDATE
  LOOP
    r := NULL; n := NULL; v_state := NULL; v_reason := NULL;
    SELECT * INTO r FROM public.push_registrations pr WHERE pr.id = d.registration_id;
    SELECT * INTO n FROM public.notifications nt WHERE nt.id = d.notification_id;
    SELECT u.account_status INTO v_state FROM public.users u WHERE u.id = d.recipient_user_id;

    v_reason := CASE
      WHEN n.id IS NULL OR (v_state IS NOT NULL AND v_state NOT IN ('CREATED', 'ACTIVE')) THEN 'recipient_unavailable'
      WHEN r.id IS NULL OR r.invalidated_at IS NOT NULL THEN 'registration_invalid'
      WHEN r.user_id IS NULL THEN 'installation_signed_out'
      WHEN r.user_id <> d.recipient_user_id OR r.installation_id <> d.installation_id THEN 'installation_reassigned'
      WHEN r.os_permission NOT IN ('granted', 'provisional') THEN 'permission_denied'
      WHEN NOT public.notification_channel_enabled(d.recipient_user_id, d.category, 'push') THEN 'preference_changed'
    END;

    IF v_reason IS NOT NULL THEN
      UPDATE public.notification_deliveries dl
         SET status = 'suppressed', suppressed_reason = v_reason, lease_token = NULL, lease_until = NULL,
             terminal_at = now(), updated_at = now()
       WHERE dl.id = d.id;
      CONTINUE;
    END IF;

    IF now() >= d.send_deadline THEN
      UPDATE public.notification_deliveries dl
         SET status = 'expired', lease_token = NULL, lease_until = NULL, terminal_at = now(), updated_at = now()
       WHERE dl.id = d.id;
      CONTINUE;
    END IF;

    UPDATE public.notification_deliveries dl
       SET status = 'sending', send_attempt = dl.send_attempt + 1, lease_until = v_until,
           available_at = v_until, updated_at = now()
     WHERE dl.id = d.id;

    INSERT INTO public.notification_delivery_attempts (
      delivery_id, attempt_no, dispatch_token, provider, registration_id, token_fingerprint)
    VALUES (d.id, d.send_attempt + 1, p_dispatch_token, d.provider, r.id, r.token_fingerprint);

    delivery_id       := d.id;
    attempt_no        := d.send_attempt + 1;
    provider          := d.provider;
    token             := r.token;
    token_fingerprint := r.token_fingerprint;
    platform          := r.platform;
    notification_id   := n.id;
    type              := n.type;
    category          := n.category;
    title             := n.title;
    body              := n.body;
    deep_link         := n.deep_link;
    data              := n.data;
    group_key         := n.group_key;
    actor_count       := n.actor_count;
    sample_actor_ids  := n.sample_actor_ids;
    send_deadline     := d.send_deadline;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Each result: {delivery_id, attempt_no, outcome_class, outcome_code, provider_code, provider_message,
-- http_status, retry_after_ms, provider_message_id, latency_ms}. Exactly-once per attempt.
CREATE OR REPLACE FUNCTION public.notification_record_push_results(p_dispatch_token uuid, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  e          jsonb;
  att        public.notification_delivery_attempts%ROWTYPE;
  d          public.notification_deliveries%ROWTYPE;
  v_class    text;
  v_code     text;
  v_status   text;
  v_late     boolean;
  v_applied  int := 0;
  v_recorded int := 0;
  v_dupes    int := 0;
  v_ignored  int := 0;
  v_invalid  int := 0;
BEGIN
  -- Lock order is delivery, then attempt (same as the sweeper), in delivery id order.
  FOR e IN
    SELECT r.value FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb)) r
    ORDER BY (r.value->>'delivery_id')::bigint
  LOOP
    v_class := e->>'outcome_class';
    v_code  := left(e->>'outcome_code', 60);

    SELECT * INTO d FROM public.notification_deliveries dl WHERE dl.id = (e->>'delivery_id')::bigint FOR UPDATE;
    IF NOT FOUND THEN
      v_dupes := v_dupes + 1;
      CONTINUE;
    END IF;

    UPDATE public.notification_delivery_attempts a
       SET outcome_class       = v_class,
           outcome_code        = v_code,
           provider_code       = left(e->>'provider_code', 120),
           provider_message    = left(e->>'provider_message', 500),
           http_status         = NULLIF(e->>'http_status', '')::int,
           retry_after_ms      = NULLIF(e->>'retry_after_ms', '')::int,
           provider_message_id = left(e->>'provider_message_id', 200),
           latency_ms          = NULLIF(e->>'latency_ms', '')::int,
           finished_at         = now(),
           late_result         = a.abandoned_at IS NOT NULL
     WHERE a.delivery_id = (e->>'delivery_id')::bigint
       AND a.attempt_no = (e->>'attempt_no')::int
       AND a.dispatch_token = p_dispatch_token
       AND a.finished_at IS NULL
    RETURNING a.* INTO att;
    IF NOT FOUND THEN
      v_dupes := v_dupes + 1;
      CONTINUE;
    END IF;
    v_recorded := v_recorded + 1;

    IF v_class = 'permanent_token' AND
       public.notification_invalidate_registration(att.registration_id, att.token_fingerprint, 'device_not_registered') THEN
      v_invalid := v_invalid + 1;
    END IF;

    IF d.send_attempt <> att.attempt_no THEN
      v_ignored := v_ignored + 1;
      CONTINUE;
    END IF;

    v_late := att.abandoned_at IS NOT NULL;
    IF d.status = 'sending' AND NOT v_late THEN
      v_status := public.notification_apply_push_outcome(d.id, v_class, v_code,
                    NULLIF(e->>'retry_after_ms', '')::int, false, false);
      v_applied := v_applied + 1;
    ELSIF v_late AND d.status IN ('retry_scheduled', 'failed_ambiguous') THEN
      v_status := public.notification_apply_push_outcome(d.id, v_class, v_code,
                    NULLIF(e->>'retry_after_ms', '')::int, true, false);
      v_applied := v_applied + 1;
    ELSE
      -- Terminal for another reason (expired, suppressed, ...): never resurrected. last_outcome_*
      -- still tracks the current attempt's effective outcome.
      UPDATE public.notification_deliveries dl
         SET last_outcome_class = v_class, last_outcome_code = v_code, updated_at = now()
       WHERE dl.id = d.id;
      v_ignored := v_ignored + 1;
      CONTINUE;
    END IF;

    IF v_status = 'provider_accepted' THEN
      UPDATE public.notification_delivery_attempts a
         SET receipt_status = 'pending', receipt_available_at = now() + interval '15 minutes',
             receipt_deadline = now() + interval '23 hours'
       WHERE a.id = att.id AND a.provider_message_id IS NOT NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('recorded', v_recorded, 'applied', v_applied, 'duplicates', v_dupes,
                            'ignored', v_ignored, 'registrations_invalidated', v_invalid);
END;
$$;

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_claim_receipts(p_provider text, p_batch int, p_lease_seconds int)
RETURNS TABLE (receipt_token uuid, attempt_id bigint, provider_message_id text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT a.id
    FROM public.notification_delivery_attempts a
    WHERE a.provider = p_provider AND a.receipt_status = 'pending' AND a.receipt_available_at <= now()
    ORDER BY a.receipt_available_at, a.id
    LIMIT LEAST(GREATEST(p_batch, 1), 1000)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_delivery_attempts a
     SET receipt_lease_token  = v_token,
         receipt_available_at = now() + make_interval(secs => p_lease_seconds),
         receipt_checks       = a.receipt_checks + 1
    FROM eligible e
   WHERE a.id = e.id
  RETURNING v_token, a.id, a.provider_message_id;
END;
$$;

-- Each entry: {attempt_id, found, outcome_class, outcome_code, provider_code, provider_message, retry_after_ms}.
CREATE OR REPLACE FUNCTION public.notification_record_receipts(p_receipt_token uuid, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  e         jsonb;
  att       public.notification_delivery_attempts%ROWTYPE;
  d         public.notification_deliveries%ROWTYPE;
  v_class   text;
  v_code    text;
  v_current boolean;
  v_ok      int := 0;
  v_errors  int := 0;
  v_waiting int := 0;
  v_unavail int := 0;
  v_invalid int := 0;
BEGIN
  FOR e IN SELECT r.value FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb)) r LOOP
    -- Lock the delivery before the attempt, matching the sweeper's order.
    d := NULL;
    SELECT dl.* INTO d FROM public.notification_deliveries dl
    JOIN public.notification_delivery_attempts a ON a.delivery_id = dl.id
    WHERE a.id = (e->>'attempt_id')::bigint
    FOR UPDATE OF dl;

    SELECT * INTO att FROM public.notification_delivery_attempts a
    WHERE a.id = (e->>'attempt_id')::bigint AND a.receipt_lease_token = p_receipt_token
      AND a.receipt_status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_current := d.id IS NOT NULL AND d.send_attempt = att.attempt_no AND d.status = 'provider_accepted';

    IF NOT COALESCE((e->>'found')::boolean, false) THEN
      IF now() < att.receipt_deadline THEN
        UPDATE public.notification_delivery_attempts a
           SET receipt_available_at = now() + public.notification_receipt_backoff(a.receipt_checks),
               receipt_lease_token = NULL, receipt_checked_at = now()
         WHERE a.id = att.id;
        v_waiting := v_waiting + 1;
      ELSE
        UPDATE public.notification_delivery_attempts a
           SET receipt_status = 'unavailable', receipt_lease_token = NULL, receipt_checked_at = now()
         WHERE a.id = att.id;
        IF v_current THEN
          UPDATE public.notification_deliveries dl
             SET status = 'receipt_unavailable', terminal_at = now(), updated_at = now()
           WHERE dl.id = d.id;
        END IF;
        v_unavail := v_unavail + 1;
      END IF;
      CONTINUE;
    END IF;

    v_class := e->>'outcome_class';
    v_code  := left(e->>'outcome_code', 60);
    UPDATE public.notification_delivery_attempts a
       SET receipt_status           = CASE WHEN v_class = 'accepted' THEN 'ok' ELSE 'error' END,
           receipt_outcome_class    = v_class,
           receipt_outcome_code     = v_code,
           receipt_provider_code    = left(e->>'provider_code', 120),
           receipt_provider_message = left(e->>'provider_message', 500),
           receipt_lease_token      = NULL,
           receipt_checked_at       = now()
     WHERE a.id = att.id;

    IF v_class = 'accepted' THEN
      v_ok := v_ok + 1;
    ELSE
      v_errors := v_errors + 1;
    END IF;

    IF v_class = 'permanent_token' AND
       public.notification_invalidate_registration(att.registration_id, att.token_fingerprint, 'device_not_registered') THEN
      v_invalid := v_invalid + 1;
    END IF;

    IF v_current THEN
      PERFORM public.notification_apply_push_outcome(d.id, v_class, v_code,
                NULLIF(e->>'retry_after_ms', '')::int, false, true);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', v_ok, 'errors', v_errors, 'waiting', v_waiting,
                            'unavailable', v_unavail, 'registrations_invalidated', v_invalid);
END;
$$;

-- ---------------------------------------------------------------------------
-- Registration (p_user_id always comes from the verified JWT in Express)
-- ---------------------------------------------------------------------------

-- Raises SQLSTATE PT409 ('installation_conflict') when the installation is bound to another live
-- user with a different token; the client then rotates its installation id.
CREATE OR REPLACE FUNCTION public.notification_register_push(
  p_user_id uuid, p_installation_id uuid, p_provider text, p_token text, p_platform text,
  p_app_version text, p_app_build text, p_locale text, p_timezone text, p_os_permission text,
  p_apns_environment text)
RETURNS TABLE (registration_id bigint, previous_user_id uuid, token_moved_from_user uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  existing      public.push_registrations%ROWTYPE;
  moved         public.push_registrations%ROWTYPE;
  v_fingerprint text := public.notification_token_fingerprint(p_token);
  v_id          bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ntf-install:' || p_installation_id::text, 0));

  SELECT * INTO existing FROM public.push_registrations r
  WHERE r.installation_id = p_installation_id AND r.provider = p_provider
  FOR UPDATE;
  IF FOUND AND existing.user_id IS NOT NULL AND existing.user_id <> p_user_id
     AND existing.invalidated_at IS NULL AND existing.token <> p_token THEN
    RAISE EXCEPTION 'installation_conflict' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO moved FROM public.push_registrations r
  WHERE r.provider = p_provider AND r.token = p_token AND r.installation_id <> p_installation_id
  FOR UPDATE;
  IF FOUND THEN
    PERFORM public.notification_suppress_installation_deliveries(moved.installation_id, 'installation_reassigned', NULL);
    DELETE FROM public.push_registrations r WHERE r.id = moved.id;
  END IF;

  INSERT INTO public.push_registrations AS r (
    installation_id, provider, token, token_fingerprint, user_id, platform, app_version, app_build,
    locale, timezone, os_permission, apns_environment, user_bound_at, last_registered_at)
  VALUES (
    p_installation_id, p_provider, p_token, v_fingerprint, p_user_id, p_platform, p_app_version, p_app_build,
    p_locale, p_timezone, p_os_permission, p_apns_environment, now(), now())
  ON CONFLICT ON CONSTRAINT push_registrations_installation_provider_uq DO UPDATE
     SET token              = EXCLUDED.token,
         token_fingerprint  = EXCLUDED.token_fingerprint,
         user_id            = EXCLUDED.user_id,
         user_bound_at      = CASE WHEN r.user_id IS DISTINCT FROM EXCLUDED.user_id THEN now() ELSE r.user_bound_at END,
         platform           = EXCLUDED.platform,
         app_version        = EXCLUDED.app_version,
         app_build          = EXCLUDED.app_build,
         locale             = EXCLUDED.locale,
         timezone           = EXCLUDED.timezone,
         os_permission      = EXCLUDED.os_permission,
         apns_environment   = EXCLUDED.apns_environment,
         last_registered_at = now(),
         invalidated_at     = NULL,
         invalid_reason     = NULL,
         updated_at         = now()
  RETURNING r.id INTO v_id;

  UPDATE public.push_registrations r
     SET user_id = p_user_id, user_bound_at = now(), updated_at = now()
   WHERE r.installation_id = p_installation_id AND r.user_id IS DISTINCT FROM p_user_id;

  IF existing.user_id IS NOT NULL AND existing.user_id <> p_user_id THEN
    PERFORM public.notification_suppress_installation_deliveries(p_installation_id, 'installation_reassigned', p_user_id);
  END IF;

  RETURN QUERY SELECT v_id, existing.user_id,
    CASE WHEN moved.id IS NOT NULL AND moved.user_id IS DISTINCT FROM p_user_id THEN moved.user_id END;
END;
$$;

-- Detaches only rows the caller owns; returns the number of registrations detached.
CREATE OR REPLACE FUNCTION public.notification_unregister_installation(p_user_id uuid, p_installation_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ntf-install:' || p_installation_id::text, 0));
  UPDATE public.push_registrations r
     SET user_id = NULL, user_bound_at = NULL, updated_at = now()
   WHERE r.installation_id = p_installation_id AND r.user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.notification_deliveries d
     SET status = 'suppressed', suppressed_reason = 'installation_signed_out', lease_token = NULL,
         lease_until = NULL, terminal_at = now(), updated_at = now()
   WHERE d.installation_id = p_installation_id AND d.recipient_user_id = p_user_id
     AND d.status IN ('pending', 'retry_scheduled', 'dispatching', 'sending');
  RETURN v_count;
END;
$$;

-- A tapped push: ownership is checked on both the notification and the delivery.
CREATE OR REPLACE FUNCTION public.notification_record_push_open(
  p_user_id uuid, p_notification_id uuid, p_delivery_id bigint, p_action text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  UPDATE public.notification_deliveries d
     SET opened_at     = COALESCE(d.opened_at, now()),
         acted_at      = CASE WHEN p_action IS NULL THEN d.acted_at ELSE COALESCE(d.acted_at, now()) END,
         opened_action = COALESCE(d.opened_action, left(p_action, 40)),
         updated_at    = now()
   WHERE d.id = p_delivery_id AND d.notification_id = p_notification_id AND d.recipient_user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN public.notification_record_open(p_user_id, p_notification_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Sweep, prune, purge, health (same signatures as Phase 1, extended for push)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_sweep(p_max_claims int, p_batch int)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_limit       int := LEAST(GREATEST(p_batch, 1), 1000);
  v_outbox_dead int;
  v_expired     int;
  v_exhausted   int;
  v_abandoned   int := 0;
  d             record;
BEGIN
  WITH exhausted AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.status IN ('pending', 'claimed')
      AND o.available_at <= now()
      AND o.claim_count >= p_max_claims
    ORDER BY o.available_at, o.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
     SET status      = 'dead',
         lease_token = NULL,
         lease_until = NULL,
         last_error  = COALESCE(o.last_error, 'claim_limit_exhausted')
    FROM exhausted e
   WHERE o.id = e.id;
  GET DIAGNOSTICS v_outbox_dead = ROW_COUNT;

  WITH late AS (
    SELECT dl.id FROM public.notification_deliveries dl
    WHERE dl.status IN ('pending', 'retry_scheduled', 'dispatching') AND dl.send_deadline <= now()
    ORDER BY dl.send_deadline
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_deliveries dl
     SET status = 'expired', lease_token = NULL, lease_until = NULL, terminal_at = now(), updated_at = now()
    FROM late l
   WHERE dl.id = l.id;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  WITH exhausted AS (
    SELECT dl.id FROM public.notification_deliveries dl
    WHERE dl.status IN ('pending', 'retry_scheduled', 'dispatching')
      AND dl.claim_count >= p_max_claims AND dl.available_at <= now()
    ORDER BY dl.provider, dl.available_at, dl.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_deliveries dl
     SET status = 'failed_dispatch', last_outcome_code = 'claim_limit_exhausted', lease_token = NULL,
         lease_until = NULL, terminal_at = now(), updated_at = now()
    FROM exhausted e
   WHERE dl.id = e.id;
  GET DIAGNOSTICS v_exhausted = ROW_COUNT;

  FOR d IN
    SELECT dl.id, dl.send_attempt FROM public.notification_deliveries dl
    WHERE dl.status = 'sending' AND dl.lease_until < now()
    ORDER BY dl.lease_until
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- outcome_* and finished_at stay reserved for a real provider result.
    UPDATE public.notification_delivery_attempts a
       SET abandoned_at = now(), abandon_reason = 'worker_lost'
     WHERE a.delivery_id = d.id AND a.attempt_no = d.send_attempt
       AND a.finished_at IS NULL AND a.abandoned_at IS NULL;
    PERFORM public.notification_apply_push_outcome(d.id, 'ambiguous', 'worker_lost', NULL, false, false);
    v_abandoned := v_abandoned + 1;
  END LOOP;

  RETURN jsonb_build_object('outbox_dead', v_outbox_dead, 'deliveries_expired', v_expired,
                            'deliveries_failed_dispatch', v_exhausted, 'sending_abandoned', v_abandoned);
END;
$$;

DROP FUNCTION IF EXISTS public.notification_prune(int, int, int, int, int, int);

-- p_delivery_days defaults to the accepted 30-day delivery/attempt retention, so Phase 1 callers keep working.
CREATE OR REPLACE FUNCTION public.notification_prune(
  p_batch int,
  p_outbox_processed_days int,
  p_outbox_dead_days int,
  p_event_key_days int,
  p_stale_after_days int,
  p_inbox_days int,
  p_delivery_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(p_batch, 1), 5000);
  v_outbox int;
  v_dead int;
  v_keys int;
  v_inbox int;
  v_deliveries int;
  v_registrations int;
BEGIN
  IF p_event_key_days <= p_stale_after_days THEN
    RAISE EXCEPTION 'notification_prune: event key retention (% d) must exceed stale cutoff (% d)',
      p_event_key_days, p_stale_after_days USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.notification_outbox
   WHERE id IN (
     SELECT o.id FROM public.notification_outbox o
     WHERE o.status = 'processed' AND o.processed_at < now() - make_interval(days => p_outbox_processed_days)
     ORDER BY o.processed_at
     LIMIT v_limit);
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  DELETE FROM public.notification_outbox
   WHERE id IN (
     SELECT o.id FROM public.notification_outbox o
     WHERE o.status = 'dead' AND o.created_at < now() - make_interval(days => p_outbox_dead_days)
     ORDER BY o.created_at
     LIMIT v_limit);
  GET DIAGNOSTICS v_dead = ROW_COUNT;

  DELETE FROM public.notification_event_keys k
   USING (
     SELECT ek.event_type, ek.idempotency_key FROM public.notification_event_keys ek
     WHERE ek.created_at < now() - make_interval(days => p_event_key_days)
     ORDER BY ek.created_at
     LIMIT v_limit) d
   WHERE k.event_type = d.event_type AND k.idempotency_key = d.idempotency_key;
  GET DIAGNOSTICS v_keys = ROW_COUNT;

  DELETE FROM public.notifications
   WHERE id IN (
     SELECT n.id FROM public.notifications n
     WHERE n.created_at < now() - make_interval(days => p_inbox_days)
     ORDER BY n.created_at
     LIMIT v_limit);
  GET DIAGNOSTICS v_inbox = ROW_COUNT;

  -- Attempts cascade from deliveries.
  DELETE FROM public.notification_deliveries
   WHERE id IN (
     SELECT dl.id FROM public.notification_deliveries dl
     WHERE dl.created_at < now() - make_interval(days => p_delivery_days)
     ORDER BY dl.created_at
     LIMIT v_limit);
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  -- Tokens that can no longer be used (signed out or invalidated) are not kept.
  DELETE FROM public.push_registrations
   WHERE id IN (
     SELECT r.id FROM public.push_registrations r
     WHERE (r.user_id IS NULL OR r.invalidated_at IS NOT NULL)
       AND r.updated_at < now() - make_interval(days => p_delivery_days)
     ORDER BY r.updated_at
     LIMIT v_limit);
  GET DIAGNOSTICS v_registrations = ROW_COUNT;

  RETURN jsonb_build_object(
    'outbox_processed', v_outbox, 'outbox_dead', v_dead, 'event_keys', v_keys, 'notifications', v_inbox,
    'deliveries', v_deliveries, 'registrations', v_registrations);
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_purge_user(p_user_id uuid, p_batch int)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_limit         int := LEAST(GREATEST(p_batch, 1), 1000);
  v_notifications int;
  v_actor_rows    int := 0;
  v_outbox        int;
  v_actor_outbox  int;
  r               record;
BEGIN
  -- Deliveries and attempts cascade from the user's notifications.
  DELETE FROM public.notifications
   WHERE id IN (SELECT n.id FROM public.notifications n WHERE n.user_id = p_user_id LIMIT v_limit);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.notification_outbox
   WHERE id IN (SELECT o.id FROM public.notification_outbox o WHERE o.recipient_user_id = p_user_id LIMIT v_limit);
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  IF v_notifications < v_limit THEN
    DELETE FROM public.notification_preferences p WHERE p.user_id = p_user_id;
    DELETE FROM public.user_notification_settings s WHERE s.user_id = p_user_id;
    DELETE FROM public.push_registrations pr WHERE pr.user_id = p_user_id;
  END IF;

  FOR r IN
    SELECT a.notification_id
    FROM public.notification_group_actors a
    JOIN public.notifications n ON n.id = a.notification_id
    WHERE a.actor_user_id = p_user_id
    ORDER BY n.user_id, a.notification_id
    LIMIT v_limit
  LOOP
    DELETE FROM public.notification_group_actors a
     WHERE a.notification_id = r.notification_id AND a.actor_user_id = p_user_id;
    v_actor_rows := v_actor_rows + 1;
  END LOOP;

  UPDATE public.notification_outbox o
     SET actor_user_id = NULL
   WHERE o.actor_user_id = p_user_id AND o.status IN ('pending', 'claimed');
  GET DIAGNOSTICS v_actor_outbox = ROW_COUNT;

  RETURN jsonb_build_object(
    'notifications_deleted', v_notifications,
    'outbox_deleted', v_outbox,
    'actor_rows_removed', v_actor_rows,
    'actor_outbox_cleared', v_actor_outbox,
    'done', v_notifications < v_limit AND v_outbox < v_limit AND v_actor_rows < v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_health_snapshot()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'outbox_oldest_due_created_at', (
      SELECT o.created_at FROM public.notification_outbox o
      WHERE o.status IN ('pending', 'claimed') AND o.available_at <= now()
      ORDER BY o.available_at, o.id LIMIT 1),
    'outbox_due_count_capped', (
      SELECT count(*) FROM (
        SELECT 1 FROM public.notification_outbox o
        WHERE o.status IN ('pending', 'claimed') AND o.available_at <= now()
        LIMIT 10000) due),
    'outbox_dead_count_capped', (
      SELECT count(*) FROM (
        SELECT 1 FROM public.notification_outbox o WHERE o.status = 'dead' LIMIT 10000) dead),
    'push_oldest_due_available_at', (
      SELECT dl.available_at FROM public.notification_deliveries dl
      WHERE dl.provider = 'expo' AND dl.status IN ('pending', 'retry_scheduled', 'dispatching')
        AND dl.available_at <= now()
      ORDER BY dl.provider, dl.available_at, dl.id LIMIT 1),
    'push_stuck_sending_count_capped', (
      SELECT count(*) FROM (
        SELECT 1 FROM public.notification_deliveries dl
        WHERE dl.status = 'sending' AND dl.lease_until < now() LIMIT 10000) stuck),
    'push_receipts_overdue_count_capped', (
      SELECT count(*) FROM (
        SELECT 1 FROM public.notification_delivery_attempts a
        WHERE a.provider = 'expo' AND a.receipt_status = 'pending'
          AND a.receipt_available_at < now() - interval '15 minutes' LIMIT 10000) overdue));
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.notification_token_fingerprint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_push_backoff(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_receipt_backoff(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_push_is_terminal(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_suppress_installation_deliveries(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_invalidate_registration(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_apply_push_outcome(bigint, text, text, int, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_materialize(bigint, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_claim_push_deliveries(text, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_begin_push_send(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_record_push_results(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_claim_receipts(text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_record_receipts(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_register_push(uuid, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_unregister_installation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_record_push_open(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_sweep(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_prune(int, int, int, int, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_purge_user(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_health_snapshot() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.notification_token_fingerprint(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_push_backoff(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_receipt_backoff(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_push_is_terminal(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_suppress_installation_deliveries(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_invalidate_registration(bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_apply_push_outcome(bigint, text, text, int, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_materialize(bigint, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_claim_push_deliveries(text, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_begin_push_send(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_record_push_results(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_claim_receipts(text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_record_receipts(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_register_push(uuid, uuid, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_unregister_installation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_record_push_open(uuid, uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_sweep(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_prune(int, int, int, int, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_purge_user(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_health_snapshot() TO service_role;
