-- Notifications Phase 7: promotional campaign fan-out and batched materialize.
-- Additive over the Phase 1–5 notification migrations. Fan-out inserts event keys + outbox
-- rows with INSERT ... SELECT in batches of 1–5000. Materialize-many is one round trip of
-- the existing notification_materialize function. Service-role only.
-- Not applied to any remote project by this change.

CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body            text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 400),
  deep_link       text        NOT NULL CHECK (deep_link LIKE '/%' AND char_length(deep_link) <= 200),
  audience        text        NOT NULL CHECK (audience IN ('all_active', 'promo_inbox', 'promo_push_opt_in')),
  status          text        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'fanout', 'completed', 'cancelled')),
  cursor_user_id  uuid,
  fanned_out      int         NOT NULL DEFAULT 0 CHECK (fanned_out >= 0),
  occurred_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_campaigns_status_idx
  ON public.notification_campaigns (status, created_at)
  WHERE status IN ('queued', 'fanout');

ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_campaigns FROM anon, authenticated;

-- Eligible recipients after the last cursor, ordered by user id so batches never overlap.
CREATE OR REPLACE FUNCTION public.notification_campaign_audience(
  p_audience text, p_cursor uuid, p_batch int)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.account_status IN ('ACTIVE', 'CREATED')
    AND (p_cursor IS NULL OR u.id > p_cursor)
    AND CASE p_audience
          WHEN 'all_active' THEN true
          WHEN 'promo_inbox' THEN public.notification_channel_enabled(u.id, 'promo', 'inbox')
          WHEN 'promo_push_opt_in' THEN public.notification_channel_enabled(u.id, 'promo', 'push')
          ELSE false
        END
  ORDER BY u.id
  LIMIT LEAST(GREATEST(p_batch, 1), 5000);
$$;

-- Set-based fan-out: event keys (dedupe) + outbox in one statement, then bump the cursor.
CREATE OR REPLACE FUNCTION public.notification_fan_out_campaign(p_campaign_id uuid, p_batch int)
RETURNS TABLE (fanned_out int, done boolean, cursor_user_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c            public.notification_campaigns%ROWTYPE;
  v_batch      int := LEAST(GREATEST(COALESCE(p_batch, 1000), 1), 5000);
  v_inserted   int := 0;
  v_picked     int := 0;
  v_last       uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ntf-campaign:' || p_campaign_id::text));
  SELECT * INTO c FROM public.notification_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT 0, true, c.cursor_user_id;
    RETURN;
  END IF;

  WITH picked AS (
    SELECT a.user_id
    FROM public.notification_campaign_audience(c.audience, c.cursor_user_id, v_batch) a
  ),
  keyed AS (
    INSERT INTO public.notification_event_keys (event_type, idempotency_key, occurred_at)
    SELECT 'promo.broadcast', 'campaign:' || p_campaign_id::text || ':' || picked.user_id, c.occurred_at
    FROM picked
    ON CONFLICT (event_type, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  ),
  boxed AS (
    INSERT INTO public.notification_outbox (
      event_type, idempotency_key, schema_version, recipient_user_id, actor_user_id, occurred_at, payload)
    SELECT
      'promo.broadcast',
      keyed.idempotency_key,
      1,
      split_part(keyed.idempotency_key, ':', 3)::uuid,
      NULL,
      c.occurred_at,
      jsonb_build_object(
        'campaignId', p_campaign_id,
        'title', c.title,
        'body', c.body,
        'deepLink', c.deep_link)
    FROM keyed
    RETURNING id, idempotency_key, recipient_user_id
  ),
  linked AS (
    UPDATE public.notification_event_keys k
       SET outbox_id = boxed.id
      FROM boxed
     WHERE k.event_type = 'promo.broadcast' AND k.idempotency_key = boxed.idempotency_key
  )
  SELECT
    (SELECT count(*)::int FROM boxed),
    (SELECT count(*)::int FROM picked),
    (SELECT user_id FROM picked ORDER BY user_id DESC LIMIT 1)
  INTO v_inserted, v_picked, v_last;

  UPDATE public.notification_campaigns
     SET status         = CASE
                            WHEN COALESCE(v_picked, 0) < v_batch THEN 'completed'
                            ELSE 'fanout'
                          END,
         cursor_user_id = COALESCE(v_last, cursor_user_id),
         fanned_out     = fanned_out + COALESCE(v_inserted, 0),
         updated_at     = now()
   WHERE id = p_campaign_id
   RETURNING notification_campaigns.fanned_out, (notification_campaigns.status = 'completed'), notification_campaigns.cursor_user_id
     INTO fanned_out, done, cursor_user_id;

  RETURN NEXT;
END;
$$;

-- One round trip: each element is {outbox_id, lease_token, render, push?}.
-- Used when outbox lag exceeds the SLO so the worker is not N RPCs behind.
CREATE OR REPLACE FUNCTION public.notification_materialize_many(p_items jsonb)
RETURNS TABLE (outbox_id bigint, outcome text, notification_id uuid, deliveries_created int)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  item jsonb;
  rec  record;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'notification_materialize_many: p_items must be a JSON array' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    SELECT m.outcome, m.notification_id, m.deliveries_created
      INTO rec
      FROM public.notification_materialize(
        (item->>'outbox_id')::bigint,
        (item->>'lease_token')::uuid,
        item->'render',
        CASE
          WHEN item ? 'push' AND jsonb_typeof(item->'push') = 'object' THEN item->'push'
          ELSE NULL
        END) m;
    outbox_id := (item->>'outbox_id')::bigint;
    outcome := rec.outcome;
    notification_id := rec.notification_id;
    deliveries_created := rec.deliveries_created;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notification_campaign_audience(text, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_fan_out_campaign(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_materialize_many(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_campaign_audience(text, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_fan_out_campaign(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_materialize_many(jsonb) TO service_role;
