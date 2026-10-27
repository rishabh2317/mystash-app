-- Phase 3: aggregate creator reporting. Local preparation only; workers/read API default off.
CREATE TABLE public.analytics_creator_daily (
 creator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 day date NOT NULL,metric text NOT NULL CHECK(metric IN ('collection_impressions','collection_opens',
 'product_impressions','merchant_requests','profile_opens','saves_added','saves_removed',
 'followers_added','followers_removed','collection_shares','likes_added','likes_removed')),
 entity_id uuid NOT NULL,namespace text NOT NULL DEFAULT '' CHECK(namespace IN ('','catalog','discovered')),
 collection_key uuid NOT NULL,value bigint NOT NULL CHECK(value>=0),
 PRIMARY KEY(creator_id,day,metric,entity_id,namespace,collection_key)
);
-- Event IDs only, without audience identity/session/properties. Bounds retry deduplication cost.
CREATE TABLE public.analytics_creator_contributions (
 source text NOT NULL CHECK(source IN ('measurement','engagement')),event_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source,event_id)
);
CREATE INDEX analytics_contributions_expiry_idx ON public.analytics_creator_contributions(recorded_at);
CREATE INDEX analytics_creator_daily_expiry_idx ON public.analytics_creator_daily(day);
CREATE INDEX analytics_facts_created_idx ON public.engagement_interaction_facts(created_at);
CREATE TABLE public.analytics_rollup_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),last_scan timestamptz NOT NULL,last_full_scan timestamptz NOT NULL
);
-- Fixed-size worker availability samples, not user sessions. Missing samples stay unknown.
CREATE TABLE public.analytics_measurement_windows (
 bucket timestamptz PRIMARY KEY,enabled boolean NOT NULL
);
ALTER TABLE public.analytics_creator_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_creator_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_rollup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_measurement_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_creator_daily,public.analytics_creator_contributions,
 public.analytics_rollup_state,public.analytics_measurement_windows FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_creator_daily,public.analytics_creator_contributions,
 public.analytics_rollup_state,public.analytics_measurement_windows TO service_role;

CREATE FUNCTION public.analytics_creator_retention() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-creator-rollup',0));
 -- During an outage preserve the final overlap's keys until the watermark advances.
 -- Otherwise resuming after nine days could count that overlap twice.
 DELETE FROM public.analytics_creator_contributions WHERE recorded_at<least(now()-interval '9 days',
  coalesce((SELECT last_scan-interval '7 days' FROM public.analytics_rollup_state WHERE singleton),'-infinity'::timestamptz));
 DELETE FROM public.analytics_creator_daily WHERE day<(now() AT TIME ZONE 'UTC')::date-interval '13 months';
 DELETE FROM public.analytics_measurement_windows WHERE bucket<now()-interval '13 months';
END; $$;

CREATE FUNCTION public.analytics_rollup_creators(p_measurement_enabled boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE previous_scan timestamptz; full_scan_at timestamptz; scan_start timestamptz; scan_end timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-creator-rollup',0));
 scan_end:=clock_timestamp();
 SELECT last_scan,last_full_scan INTO previous_scan,full_scan_at FROM public.analytics_rollup_state WHERE singleton;
 scan_start:=coalesce(previous_scan-interval '15 minutes','-infinity'::timestamptz);
 IF full_scan_at IS NULL OR full_scan_at<scan_end-interval '1 day' THEN
  scan_start:=least(scan_start,scan_end-interval '7 days');full_scan_at:=scan_end;
 END IF;
 -- First run backfills retained engagement facts. Subsequent runs use indexed server arrival time,
 -- a 15-minute overlap, and daily seven-day catch-up for delayed commits. Ownership is authoritative.
 WITH candidates AS (
  SELECT 'measurement'::text AS source,e.event_id,(e.occurred_at AT TIME ZONE 'UTC')::date AS day,
   CASE e.event_name WHEN 'collection.impression' THEN 'collection_impressions'
    WHEN 'collection.opened' THEN 'collection_opens' WHEN 'product.impression' THEN 'product_impressions'
    WHEN 'merchant.outbound_resolved' THEN 'merchant_requests' WHEN 'creator.profile_opened' THEN 'profile_opens' END AS metric,
   CASE WHEN e.event_name='creator.profile_opened' THEN e.entity_id ELSE c.creator_id END AS creator_id,
   e.entity_id,coalesce(e.namespace,'') AS namespace,
   coalesce(c.id,'00000000-0000-0000-0000-000000000000') AS collection_key
  FROM public.analytics_events e
  LEFT JOIN public.collections c ON c.id=e.collection_id AND c.creator_id=e.creator_id
   AND c.status='published' AND c.visibility='public' AND c.moderation_state='clear' AND c.deleted_at IS NULL
  WHERE e.received_at<=scan_end AND e.received_at>=scan_start
   AND (c.id IS NOT NULL OR (e.event_name='creator.profile_opened' AND e.entity_type='creator'))
   AND (e.entity_type<>'product' OR EXISTS(SELECT 1 FROM public.collection_product_tags t
    WHERE t.collection_id=c.id AND ((e.namespace='catalog' AND t.catalog_product_id=e.entity_id)
     OR (e.namespace='discovered' AND t.discovered_product_id=e.entity_id))))
  UNION ALL
  SELECT 'engagement',f.event_id,(f.occurred_at AT TIME ZONE 'UTC')::date,
   CASE f.interaction_type WHEN 'save' THEN 'saves_added' WHEN 'unsave' THEN 'saves_removed'
    WHEN 'follow' THEN 'followers_added' WHEN 'unfollow' THEN 'followers_removed'
    WHEN 'share' THEN 'collection_shares' WHEN 'like' THEN 'likes_added' WHEN 'unlike' THEN 'likes_removed' END,
   CASE WHEN f.object_type='creator' THEN u.id ELSE c.creator_id END,
   CASE WHEN f.object_type='creator' THEN u.id ELSE c.id END,'',
   coalesce(c.id,'00000000-0000-0000-0000-000000000000')
  FROM public.engagement_interaction_facts f
  LEFT JOIN public.collections c ON c.id=f.collection_id
   AND c.status='published' AND c.visibility='public' AND c.moderation_state='clear' AND c.deleted_at IS NULL
  LEFT JOIN public.users u ON f.object_type='creator' AND f.object_id=u.id::text
   AND u.deleted_at IS NULL AND u.account_status<>'DELETED'
  WHERE f.created_at<=scan_end AND f.created_at>=scan_start
   AND ((f.object_type='creator' AND f.interaction_type IN ('follow','unfollow') AND u.id IS NOT NULL)
    OR (f.object_type='collection' AND f.interaction_type IN ('save','unsave','share') AND c.id IS NOT NULL)
    OR (f.object_type='reel' AND f.interaction_type IN ('like','unlike') AND c.id IS NOT NULL))
 ), eligible AS (
  SELECT x.* FROM candidates x JOIN public.users u ON u.id=x.creator_id
  WHERE x.metric IS NOT NULL AND x.entity_id IS NOT NULL AND u.deleted_at IS NULL AND u.account_status<>'DELETED'
   AND x.day>=(scan_end AT TIME ZONE 'UTC')::date-interval '13 months'
 ), inserted AS (
  INSERT INTO public.analytics_creator_contributions(source,event_id,recorded_at)
  SELECT source,event_id,scan_end FROM eligible ON CONFLICT DO NOTHING RETURNING source,event_id
 )
 INSERT INTO public.analytics_creator_daily(creator_id,day,metric,entity_id,namespace,collection_key,value)
 SELECT e.creator_id,e.day,e.metric,e.entity_id,e.namespace,e.collection_key,count(*)
 FROM eligible e JOIN inserted i USING(source,event_id)
 GROUP BY e.creator_id,e.day,e.metric,e.entity_id,e.namespace,e.collection_key
 ON CONFLICT(creator_id,day,metric,entity_id,namespace,collection_key)
 DO UPDATE SET value=public.analytics_creator_daily.value+excluded.value;

 INSERT INTO public.analytics_rollup_state VALUES(true,scan_end,full_scan_at)
 ON CONFLICT(singleton) DO UPDATE SET last_scan=excluded.last_scan,last_full_scan=excluded.last_full_scan;
 INSERT INTO public.analytics_measurement_windows(bucket,enabled)
 VALUES(date_trunc('hour',scan_end)+floor(extract(minute FROM scan_end)/5)*interval '5 minutes',coalesce(p_measurement_enabled,false))
 ON CONFLICT(bucket) DO UPDATE SET enabled=public.analytics_measurement_windows.enabled AND excluded.enabled;
 -- Process the overlap BEFORE expiring dedupe keys; long outages cannot re-add previous contributions.
 PERFORM public.analytics_creator_retention();
END; $$;

ALTER FUNCTION public.analytics_maintenance() RENAME TO analytics_maintenance_v2;
CREATE FUNCTION public.analytics_maintenance() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM public.analytics_creator_retention();
 RETURN public.analytics_maintenance_v2();
END; $$;

CREATE FUNCTION public.analytics_creator_report(p_creator_id uuid,p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE end_day date:=(now() AT TIME ZONE 'UTC')::date; result jsonb;
BEGIN
 IF p_days NOT IN (7,30,90) OR p_days IS NULL THEN RAISE EXCEPTION 'Invalid range' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_creator_id AND creator_status<>'NONE'
  AND deleted_at IS NULL AND account_status<>'DELETED') THEN RAISE EXCEPTION 'Creator unavailable' USING ERRCODE='42501'; END IF;
 WITH scoped AS MATERIALIZED (
  SELECT d.* FROM public.analytics_creator_daily d
  LEFT JOIN public.collections c ON c.id=d.collection_key AND c.creator_id=p_creator_id
   AND c.status='published' AND c.visibility='public' AND c.moderation_state='clear' AND c.deleted_at IS NULL
  WHERE d.creator_id=p_creator_id AND d.day>=end_day-p_days*2 AND d.day<end_day
   AND (d.collection_key='00000000-0000-0000-0000-000000000000' OR c.id IS NOT NULL)
   AND (d.namespace='' OR EXISTS(SELECT 1 FROM public.collection_product_tags t WHERE t.collection_id=c.id
    AND ((d.namespace='catalog' AND t.catalog_product_id=d.entity_id) OR (d.namespace='discovered' AND t.discovered_product_id=d.entity_id))))
 ), daily AS (
  SELECT day,metric,sum(value) AS value FROM scoped GROUP BY day,metric
 ), collections AS (
  SELECT d.collection_key AS id,sum(value) FILTER(WHERE metric='collection_opens') AS opens,
   sum(value) FILTER(WHERE metric='saves_added') AS saves,sum(value) FILTER(WHERE metric='merchant_requests') AS requests
  FROM scoped d WHERE d.day>=end_day-p_days AND d.collection_key<>'00000000-0000-0000-0000-000000000000'
  GROUP BY d.collection_key
  HAVING sum(value) FILTER(WHERE metric IN ('collection_opens','saves_added','merchant_requests'))>0
 ), top_collections AS (
  SELECT a.id,c.title,c.hero_thumbnail_url AS thumbnail_url,coalesce(a.opens,0) AS opens,
   coalesce(a.saves,0) AS saves,coalesce(a.requests,0) AS requests
  FROM collections a JOIN public.collections c ON c.id=a.id
  ORDER BY coalesce(a.opens,0) DESC,coalesce(a.requests,0) DESC,coalesce(a.saves,0) DESC,a.id LIMIT 5
 ), products AS (
  SELECT d.entity_id AS id,d.namespace,sum(value) FILTER(WHERE metric='product_impressions') AS impressions,
   sum(value) FILTER(WHERE metric='merchant_requests') AS requests
  FROM scoped d WHERE d.day>=end_day-p_days AND d.namespace IN ('catalog','discovered')
   AND metric IN ('product_impressions','merchant_requests') GROUP BY d.entity_id,d.namespace
 ), top_products AS (
  SELECT a.id,a.namespace,coalesce(cp.name,dp.name,'Product') AS title,
   coalesce(cp.image_url,dp.image_url) AS thumbnail_url,
   coalesce(a.impressions,0) AS impressions,coalesce(a.requests,0) AS requests
  FROM products a LEFT JOIN public.catalog_products cp ON a.namespace='catalog' AND cp.id=a.id AND cp.status<>'HIDDEN'
  LEFT JOIN public.discovered_products dp ON a.namespace='discovered' AND dp.id=a.id AND dp.internal_status='ACTIVE'
  WHERE cp.id IS NOT NULL OR dp.id IS NOT NULL
  ORDER BY coalesce(a.requests,0) DESC,coalesce(a.impressions,0) DESC,a.namespace,a.id LIMIT 5
 )
 SELECT jsonb_build_object('days',p_days,'end_day',end_day,'generated_at',now(),
  'refreshed_at',(SELECT last_scan FROM public.analytics_rollup_state WHERE singleton),
  'daily',coalesce((SELECT jsonb_agg(to_jsonb(daily) ORDER BY day,metric) FROM daily),'[]'),
  'coverage',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (
    SELECT (bucket AT TIME ZONE 'UTC')::date AS day,count(*) FILTER(WHERE enabled) AS windows
    FROM public.analytics_measurement_windows WHERE bucket>=(end_day-p_days*2)::timestamp AT TIME ZONE 'UTC'
     AND bucket<end_day::timestamp AT TIME ZONE 'UTC' GROUP BY 1) a),'[]'),
  'top_collections',coalesce((SELECT jsonb_agg(to_jsonb(top_collections)) FROM top_collections),'[]'),
  'top_products',coalesce((SELECT jsonb_agg(to_jsonb(top_products)) FROM top_products),'[]')) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_creator_retention(),public.analytics_maintenance(),public.analytics_rollup_creators(boolean),public.analytics_creator_report(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_creator_retention(),public.analytics_maintenance(),public.analytics_rollup_creators(boolean),public.analytics_creator_report(uuid,integer) TO service_role;
