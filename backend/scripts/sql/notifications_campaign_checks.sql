-- Phase 7 campaign fan-out + batched materialize. Relies on t.run from
-- notifications_push_checks.sql (loaded first in the scratch harness).

SELECT t.run('campaign: schema, grants, set-based fan-out batches and replay', $c$
  DO $$
  DECLARE
    cid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    r1 record;
    r3 record;
    keyed int;
    boxed int;
  BEGIN
    PERFORM t.user_();
    PERFORM t.user_();
    PERFORM t.user_();
    PERFORM t.user_();
    PERFORM t.user_();
    INSERT INTO public.notification_campaigns (id, name, title, body, deep_link, audience, occurred_at)
    VALUES (cid, 'spring', 'Something new on Mystash', 'Open the app to see this week’s picks.', '/notifications', 'all_active', now());
    SELECT * INTO r1 FROM public.notification_fan_out_campaign(cid, 2);
    PERFORM t.check(r1.fanned_out = 2 AND r1.done = false, 'campaign: first batch of 2 is not done');
    PERFORM public.notification_fan_out_campaign(cid, 2);
    SELECT * INTO r3 FROM public.notification_fan_out_campaign(cid, 5000);
    SELECT count(*) INTO keyed FROM public.notification_event_keys k
      WHERE k.event_type = 'promo.broadcast' AND k.idempotency_key LIKE 'campaign:' || cid::text || ':%';
    SELECT count(*) INTO boxed FROM public.notification_outbox o
      WHERE o.idempotency_key LIKE 'campaign:' || cid::text || ':%';
    PERFORM t.check(
      boxed = (SELECT fanned_out FROM public.notification_campaigns WHERE id = cid)
      AND (SELECT status FROM public.notification_campaigns WHERE id = cid) = 'completed'
      AND r3.done = true
      AND keyed = boxed,
      'campaign: remaining batches complete without duplicating keys');
  END $$;
$c$);

SELECT t.run('campaign: promo_push_opt_in skips users without the opt-in', $c$
  DO $$
  DECLARE cid uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  BEGIN
    INSERT INTO public.notification_campaigns (id, name, title, body, deep_link, audience, occurred_at)
    VALUES (cid, 'optin', 'Offers', 'News you opted into.', '/notifications', 'promo_push_opt_in', now());
    PERFORM public.notification_fan_out_campaign(cid, 5000);
    PERFORM t.check(
      (SELECT fanned_out FROM public.notification_campaigns WHERE id = cid) = 0
      AND (SELECT status FROM public.notification_campaigns WHERE id = cid) = 'completed',
      'campaign: empty promo-push audience completes with zero rows');
  END $$;
$c$);

SELECT t.run('campaign: materialize_many is one round trip of notification_materialize', $c$
  DO $$
  DECLARE
    cid uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    payload jsonb;
    created int;
  BEGIN
    INSERT INTO public.notification_campaigns (id, name, title, body, deep_link, audience, occurred_at)
    VALUES (cid, 'batch', 'Batch title', 'Batch body.', '/notifications', 'all_active', now());
    PERFORM public.notification_fan_out_campaign(cid, 2);
    UPDATE public.notification_outbox o
       SET status = 'claimed',
           lease_token = gen_random_uuid(),
           lease_until = now() + interval '60 seconds',
           available_at = now() + interval '60 seconds',
           claim_count = o.claim_count + 1
     WHERE o.idempotency_key LIKE 'campaign:' || cid::text || ':%'
       AND o.status = 'pending';
    SELECT jsonb_agg(jsonb_build_object(
      'outbox_id', o.id,
      'lease_token', o.lease_token,
      'render', jsonb_build_object(
        'type', 'promo.broadcast',
        'category', 'promo',
        'title', 'Batch title',
        'body', 'Batch body.',
        'data', jsonb_build_object('campaignId', cid),
        'deep_link', '/notifications',
        'group_key', NULL,
        'group_window_seconds', NULL,
        'requires_actor', false,
        'expires_at', NULL)
    )) INTO payload
    FROM public.notification_outbox o
    WHERE o.idempotency_key LIKE 'campaign:' || cid::text || ':%'
      AND o.status = 'claimed';
    SELECT count(*) INTO created FROM public.notification_materialize_many(payload) r WHERE r.outcome = 'created';
    PERFORM t.check(
      created = 2
      AND (SELECT count(*) FROM public.notifications n WHERE n.type = 'promo.broadcast' AND n.title = 'Batch title') >= 2,
      'campaign: materialize_many creates inbox rows');
  END $$;
$c$);

SELECT t.run('campaign: execute revoked from anon/authenticated', $c$
  SELECT t.check(
    NOT has_function_privilege('anon', 'public.notification_fan_out_campaign(uuid,int)', 'execute')
    AND NOT has_function_privilege('authenticated', 'public.notification_fan_out_campaign(uuid,int)', 'execute')
    AND has_function_privilege('service_role', 'public.notification_fan_out_campaign(uuid,int)', 'execute')
    AND has_function_privilege('service_role', 'public.notification_materialize_many(jsonb)', 'execute'),
    'campaign: execute revoked from anon/authenticated');
$c$);
