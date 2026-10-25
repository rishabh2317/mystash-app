-- Notifications Phase 1: durable event keys, outbox, inbox, aggregation actors, preferences.
-- Push tables (registrations, deliveries, attempts) arrive in a later migration.
-- All access is service-role only (Express + worker); mobile never reads these tables directly.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_event_keys (
  event_type      text        NOT NULL,
  idempotency_key text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  occurred_at     timestamptz NOT NULL,
  outbox_id       bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS notification_event_keys_prune_idx
  ON public.notification_event_keys (created_at);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type        text        NOT NULL,
  idempotency_key   text        NOT NULL,
  schema_version    smallint    NOT NULL DEFAULT 1,
  recipient_user_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  actor_user_id     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  occurred_at       timestamptz NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(payload) <= 8192),
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'processed', 'dead')),
  available_at      timestamptz NOT NULL DEFAULT now(),
  lease_token       uuid,
  lease_until       timestamptz,
  claim_count       int         NOT NULL DEFAULT 0,
  failure_count     int         NOT NULL DEFAULT 0,
  last_error        text        CHECK (char_length(last_error) <= 1000),
  result            text        CHECK (result IN (
                      'created', 'aggregated', 'suppressed_preference', 'suppressed_recipient',
                      'suppressed_self', 'suppressed_actor_unavailable')),
  notification_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  CONSTRAINT notification_outbox_lease_chk
    CHECK ((status = 'claimed') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CONSTRAINT notification_outbox_processed_chk
    CHECK ((status = 'processed') = (processed_at IS NOT NULL AND result IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
  ON public.notification_outbox (available_at, id) WHERE status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS notification_outbox_prune_idx
  ON public.notification_outbox (processed_at) WHERE status = 'processed';
CREATE INDEX IF NOT EXISTS notification_outbox_dead_idx
  ON public.notification_outbox (created_at) WHERE status = 'dead';
CREATE INDEX IF NOT EXISTS notification_outbox_recipient_idx
  ON public.notification_outbox (recipient_user_id);
CREATE INDEX IF NOT EXISTS notification_outbox_actor_open_idx
  ON public.notification_outbox (actor_user_id) WHERE status IN ('pending', 'claimed');

CREATE TABLE IF NOT EXISTS public.notifications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type               text        NOT NULL,
  category           text        NOT NULL CHECK (category IN ('social', 'task', 'account', 'security', 'promo')),
  schema_version     smallint    NOT NULL DEFAULT 1,
  -- Never contains actor names; actor-bearing types are rendered from sample_actor_ids at read/send time.
  title              text        NOT NULL CHECK (char_length(title) <= 120),
  body               text        NOT NULL CHECK (char_length(body) <= 400),
  inbox_visible      boolean     NOT NULL DEFAULT true,
  data               jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(data) <= 4096),
  deep_link          text        CHECK (deep_link LIKE '/%'),
  group_key          text,
  group_bucket       timestamptz,
  actor_count        int         NOT NULL DEFAULT 0,
  event_count        int         NOT NULL DEFAULT 0,
  sample_actor_ids   uuid[]      NOT NULL DEFAULT '{}' CHECK (cardinality(sample_actor_ids) <= 3),
  last_actor_user_id uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  push_decision      text        NOT NULL DEFAULT 'not_applicable'
                     CHECK (push_decision IN (
                       'not_applicable', 'queued', 'no_registrations', 'suppressed_preference',
                       'suppressed_rate_limit', 'suppressed_cooldown', 'suppressed_quiet_hours',
                       'suppressed_kill_switch')),
  sort_at            timestamptz NOT NULL DEFAULT now(),
  seen_at            timestamptz,
  read_at            timestamptz,
  archived_at        timestamptz,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_group_chk CHECK ((group_key IS NULL) = (group_bucket IS NULL))
);

CREATE INDEX IF NOT EXISTS notifications_feed_idx
  ON public.notifications (user_id, sort_at DESC, id DESC) WHERE archived_at IS NULL AND inbox_visible;
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (user_id) WHERE read_at IS NULL AND archived_at IS NULL AND inbox_visible;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_group_uq
  ON public.notifications (user_id, group_key, group_bucket) WHERE group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_push_rate_idx
  ON public.notifications (user_id, category, created_at) WHERE push_decision = 'queued';
CREATE INDEX IF NOT EXISTS notifications_prune_idx
  ON public.notifications (created_at);

CREATE TABLE IF NOT EXISTS public.notification_group_actors (
  notification_id uuid        NOT NULL REFERENCES public.notifications (id) ON DELETE CASCADE,
  actor_user_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  first_outbox_id bigint      NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, actor_user_id)
);

CREATE INDEX IF NOT EXISTS notification_group_actors_actor_idx
  ON public.notification_group_actors (actor_user_id);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category   text        NOT NULL CHECK (category IN ('social', 'task', 'account', 'promo')),
  channel    text        NOT NULL CHECK (channel IN ('inbox', 'push')),
  enabled    boolean     NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, channel),
  -- Task/account inbox and all security channels are always on.
  CONSTRAINT notification_preferences_pair_chk CHECK (category IN ('social', 'promo') OR channel = 'push')
);

CREATE TABLE IF NOT EXISTS public.user_notification_settings (
  user_id           uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  timezone          text        NOT NULL DEFAULT 'UTC',
  quiet_hours_start time,
  quiet_hours_end   time,
  promo_opt_in_at   timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiet_hours_pair_chk CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);

ALTER TABLE public.notification_event_keys     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_group_actors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_settings  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.notification_event_keys,
  public.notification_outbox,
  public.notifications,
  public.notification_group_actors,
  public.notification_preferences,
  public.user_notification_settings
FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Absent preference row = enabled, except promo push which requires an explicit opt-in.
CREATE OR REPLACE FUNCTION public.notification_channel_enabled(
  p_user_id uuid, p_category text, p_channel text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_category = 'security' THEN true
    WHEN p_channel = 'inbox' AND p_category IN ('task', 'account') THEN true
    WHEN p_channel = 'push' AND p_category = 'promo' THEN
      COALESCE((SELECT p.enabled FROM public.notification_preferences p
                WHERE p.user_id = p_user_id AND p.category = p_category AND p.channel = p_channel), false)
      AND EXISTS (SELECT 1 FROM public.user_notification_settings s
                  WHERE s.user_id = p_user_id AND s.promo_opt_in_at IS NOT NULL)
    ELSE
      COALESCE((SELECT p.enabled FROM public.notification_preferences p
                WHERE p.user_id = p_user_id AND p.category = p_category AND p.channel = p_channel), true)
  END;
$$;

-- ---------------------------------------------------------------------------
-- Producer: durable dedupe + outbox insert in one transaction
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_enqueue_event(
  p_event_type text,
  p_idempotency_key text,
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_schema_version smallint,
  p_stale_after_seconds int)
RETURNS TABLE (outbox_id bigint, outcome text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id bigint;
  v_inserted int;
BEGIN
  IF p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'notification_enqueue_event: occurred_at is in the future' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at < now() - make_interval(secs => p_stale_after_seconds) THEN
    RETURN QUERY SELECT NULL::bigint, 'stale'::text;
    RETURN;
  END IF;
  IF p_actor_user_id IS NOT NULL AND p_actor_user_id = p_recipient_user_id THEN
    RETURN QUERY SELECT NULL::bigint, 'self'::text;
    RETURN;
  END IF;

  INSERT INTO public.notification_event_keys (event_type, idempotency_key, occurred_at)
  VALUES (p_event_type, p_idempotency_key, p_occurred_at)
  ON CONFLICT (event_type, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN QUERY SELECT NULL::bigint, 'duplicate'::text;
    RETURN;
  END IF;

  INSERT INTO public.notification_outbox (
    event_type, idempotency_key, schema_version, recipient_user_id, actor_user_id, occurred_at, payload)
  VALUES (
    p_event_type, p_idempotency_key, p_schema_version, p_recipient_user_id, p_actor_user_id,
    p_occurred_at, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  UPDATE public.notification_event_keys k
     SET outbox_id = v_id
   WHERE k.event_type = p_event_type AND k.idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_id, 'enqueued'::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- Materializer: claim, materialize, fail
-- ---------------------------------------------------------------------------

-- Claiming sets available_at = lease_until, so one predicate covers due rows and expired leases.
CREATE OR REPLACE FUNCTION public.notification_claim_outbox(
  p_batch int, p_lease_seconds int, p_max_claims int)
RETURNS TABLE (outbox_id bigint, lease_token uuid, claim_count int, event_type text,
               schema_version smallint, recipient_user_id uuid, actor_user_id uuid,
               occurred_at timestamptz, payload jsonb)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
  WITH eligible AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.status IN ('pending', 'claimed')
      AND o.available_at <= now()
      AND o.claim_count < p_max_claims
    ORDER BY o.available_at, o.id
    LIMIT LEAST(GREATEST(p_batch, 1), 500)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
     SET status       = 'claimed',
         lease_token  = gen_random_uuid(),
         lease_until  = now() + make_interval(secs => p_lease_seconds),
         available_at = now() + make_interval(secs => p_lease_seconds),
         claim_count  = o.claim_count + 1
    FROM eligible e
   WHERE o.id = e.id
  RETURNING o.id, o.lease_token, o.claim_count, o.event_type, o.schema_version,
            o.recipient_user_id, o.actor_user_id, o.occurred_at, o.payload;
$$;

-- p_render is produced by the TS event-type registry (deterministic from the payload).
CREATE OR REPLACE FUNCTION public.notification_materialize(
  p_outbox_id bigint, p_lease_token uuid, p_render jsonb)
RETURNS TABLE (outcome text, notification_id uuid)
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
  v_recipient_state text;
  v_actor_state     text;
  v_inbox_on        boolean;
  v_push_on         boolean := false;
  v_bucket          timestamptz;
  v_id              uuid;
  v_first           boolean := false;
  v_new_actor       int     := 0;
  v_result          text;
BEGIN
  SELECT * INTO o
  FROM public.notification_outbox ob
  WHERE ob.id = p_outbox_id AND ob.status = 'claimed' AND ob.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::uuid;
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
    -- No push channel exists before the push migration.
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
    -- Bucket from the source time so a retry always lands in the same aggregate.
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

  UPDATE public.notification_outbox ob
     SET status          = 'processed',
         result          = v_result,
         notification_id = v_id,
         processed_at    = now(),
         lease_token     = NULL,
         lease_until     = NULL
   WHERE ob.id = o.id;

  RETURN QUERY SELECT v_result, v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_fail_outbox(
  p_outbox_id bigint, p_lease_token uuid, p_error text, p_retry_seconds int, p_max_failures int)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE public.notification_outbox o
     SET failure_count = o.failure_count + 1,
         status        = CASE WHEN o.failure_count + 1 >= p_max_failures THEN 'dead' ELSE 'pending' END,
         available_at  = now() + make_interval(secs => GREATEST(p_retry_seconds, 0)),
         lease_token   = NULL,
         lease_until   = NULL,
         last_error    = left(p_error, 1000)
   WHERE o.id = p_outbox_id AND o.status = 'claimed' AND o.lease_token = p_lease_token
  RETURNING o.status INTO v_status;
  IF v_status IS NULL THEN
    RETURN 'lease_lost';
  END IF;
  RETURN CASE WHEN v_status = 'dead' THEN 'dead' ELSE 'retrying' END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Sweep + prune
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_sweep(p_max_claims int, p_batch int)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_outbox_dead int;
BEGIN
  WITH exhausted AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.status IN ('pending', 'claimed')
      AND o.available_at <= now()
      AND o.claim_count >= p_max_claims
    ORDER BY o.available_at, o.id
    LIMIT LEAST(GREATEST(p_batch, 1), 1000)
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

  RETURN jsonb_build_object('outbox_dead', v_outbox_dead);
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_prune(
  p_batch int,
  p_outbox_processed_days int,
  p_outbox_dead_days int,
  p_event_key_days int,
  p_stale_after_days int,
  p_inbox_days int)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(p_batch, 1), 5000);
  v_outbox int;
  v_dead int;
  v_keys int;
  v_inbox int;
BEGIN
  -- Dedupe safety: a pruned key must always be older than the enqueue stale cutoff.
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

  RETURN jsonb_build_object(
    'outbox_processed', v_outbox, 'outbox_dead', v_dead, 'event_keys', v_keys, 'notifications', v_inbox);
END;
$$;

-- ---------------------------------------------------------------------------
-- Inbox reads and writes (p_user_id always comes from the verified JWT in Express)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_list_feed(
  p_user_id uuid, p_before_sort_at timestamptz, p_before_id uuid, p_limit int, p_category text)
RETURNS SETOF public.notifications
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT n.*
  FROM public.notifications n
  WHERE n.user_id = p_user_id
    AND n.archived_at IS NULL
    AND n.inbox_visible
    AND (n.expires_at IS NULL OR n.expires_at > now())
    AND (p_category IS NULL OR n.category = p_category)
    AND (p_before_sort_at IS NULL OR (n.sort_at, n.id) < (p_before_sort_at, p_before_id))
  ORDER BY n.sort_at DESC, n.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.notification_unread_count(p_user_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT count(*)::int FROM (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.read_at IS NULL
      AND n.archived_at IS NULL
      AND n.inbox_visible
      AND (n.expires_at IS NULL OR n.expires_at > now())
    LIMIT 100
  ) capped;
$$;

-- Exactly one selector: p_ids, or a (sort_at, id) cursor upper bound, or neither (= all).
CREATE OR REPLACE FUNCTION public.notification_mark_read(
  p_user_id uuid, p_ids uuid[], p_before_sort_at timestamptz, p_before_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.notifications n
     SET read_at = now(), seen_at = COALESCE(n.seen_at, now()), updated_at = now()
   WHERE n.user_id = p_user_id
     AND n.read_at IS NULL
     AND n.inbox_visible
     AND (p_ids IS NULL OR n.id = ANY (p_ids))
     AND (p_before_sort_at IS NULL OR (n.sort_at, n.id) <= (p_before_sort_at, p_before_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_mark_seen(
  p_user_id uuid, p_before_sort_at timestamptz, p_before_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.notifications n
     SET seen_at = now(), updated_at = now()
   WHERE n.user_id = p_user_id
     AND n.seen_at IS NULL
     AND n.inbox_visible
     AND (n.sort_at, n.id) <= (p_before_sort_at, p_before_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Works for push-only rows too (a tapped push); never changes inbox_visible.
CREATE OR REPLACE FUNCTION public.notification_record_open(p_user_id uuid, p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications n
     SET read_at = COALESCE(n.read_at, now()), seen_at = COALESCE(n.seen_at, now()), updated_at = now()
   WHERE n.id = p_notification_id AND n.user_id = p_user_id;
  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- Account deletion (soft delete keeps auth.users, so cascades never fire)
-- ---------------------------------------------------------------------------

-- Recomputes the aggregate from the remaining actor rows; deletes the notification at zero actors.
-- SECURITY DEFINER: also fires from auth.users hard-delete cascades run by non-service roles.
CREATE OR REPLACE FUNCTION public.notification_group_actors_after_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user   uuid;
  v_count  int;
  v_sample uuid[];
  v_last   uuid;
BEGIN
  SELECT n.user_id INTO v_user FROM public.notifications n WHERE n.id = OLD.notification_id;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ntf:' || v_user::text, 0));
  PERFORM 1 FROM public.notifications n WHERE n.id = OLD.notification_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::int,
         (array_agg(a.actor_user_id ORDER BY a.created_at, a.actor_user_id))[1:3],
         (array_agg(a.actor_user_id ORDER BY a.created_at DESC, a.actor_user_id DESC))[1]
    INTO v_count, v_sample, v_last
  FROM public.notification_group_actors a
  WHERE a.notification_id = OLD.notification_id;

  IF v_count = 0 THEN
    DELETE FROM public.notifications n WHERE n.id = OLD.notification_id;
  ELSE
    UPDATE public.notifications n
       SET actor_count        = v_count,
           sample_actor_ids   = COALESCE(v_sample, '{}'::uuid[]),
           last_actor_user_id = v_last,
           updated_at         = now()
     WHERE n.id = OLD.notification_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notification_group_actors_after_delete_trg ON public.notification_group_actors;
CREATE TRIGGER notification_group_actors_after_delete_trg
  AFTER DELETE ON public.notification_group_actors
  FOR EACH ROW EXECUTE FUNCTION public.notification_group_actors_after_delete();

-- Idempotent; call repeatedly until done = true. Actor rows are removed in recipient order so
-- per-recipient advisory locks are always acquired in a consistent order.
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
  DELETE FROM public.notifications
   WHERE id IN (SELECT n.id FROM public.notifications n WHERE n.user_id = p_user_id LIMIT v_limit);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.notification_outbox
   WHERE id IN (SELECT o.id FROM public.notification_outbox o WHERE o.recipient_user_id = p_user_id LIMIT v_limit);
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  IF v_notifications < v_limit THEN
    DELETE FROM public.notification_preferences p WHERE p.user_id = p_user_id;
    DELETE FROM public.user_notification_settings s WHERE s.user_id = p_user_id;
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

-- ---------------------------------------------------------------------------
-- Health
-- ---------------------------------------------------------------------------

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
        SELECT 1 FROM public.notification_outbox o WHERE o.status = 'dead' LIMIT 10000) dead));
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.notification_channel_enabled(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_enqueue_event(text, text, uuid, uuid, timestamptz, jsonb, smallint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_claim_outbox(int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_materialize(bigint, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_fail_outbox(bigint, uuid, text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_sweep(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_prune(int, int, int, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_list_feed(uuid, timestamptz, uuid, int, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_unread_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_mark_read(uuid, uuid[], timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_mark_seen(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_record_open(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_group_actors_after_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_purge_user(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_health_snapshot() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.notification_channel_enabled(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_enqueue_event(text, text, uuid, uuid, timestamptz, jsonb, smallint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_claim_outbox(int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_materialize(bigint, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_fail_outbox(bigint, uuid, text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_sweep(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_prune(int, int, int, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_list_feed(uuid, timestamptz, uuid, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_unread_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_mark_read(uuid, uuid[], timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_mark_seen(uuid, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_record_open(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_purge_user(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_health_snapshot() TO service_role;
