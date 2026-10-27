-- Phase 4 local preparation. No membership is granted and all runtime flags default off.
CREATE TABLE public.analytics_admin_members (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.analytics_admin_access_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admin_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 accessed_at timestamptz NOT NULL DEFAULT now(),range_days integer NOT NULL CHECK(range_days IN (7,30,90))
);
CREATE INDEX analytics_admin_access_expiry_idx ON public.analytics_admin_access_log(accessed_at);
CREATE TABLE public.analytics_admin_daily (
 day date NOT NULL,metric text NOT NULL CHECK(metric IN ('app_sessions','collection_opens','collection_impressions',
 'product_opens','product_impressions','place_impressions','place_outbound_requests','profile_opens',
 'search_responses','search_zero_matches','search_with_fallback','search_matching_results','search_fallback_results',
 'search_latency_ms','search_clicks','search_click_rank_sum','merchant_requests','affiliate_requests',
 'saves_added','saves_removed','follows_added','follows_removed','likes_added','likes_removed','collection_shares')),
 dimension text NOT NULL CHECK(dimension IN ('all','platform:ios','platform:android','platform:web','platform:server',
 'category:sports','category:fashion','category:beauty','category:electronics','category:home','category:food',
 'category:automotive','category:outdoors','category:gaming','category:travel','category:other',
 'filter:creatorId','filter:brand','filter:category','filter:verifiedOnly','filter:recentlyPublished','filter:popular','filter:priceMin','filter:priceMax')),
 value bigint NOT NULL CHECK(value>=0),PRIMARY KEY(day,metric,dimension)
);
CREATE INDEX analytics_admin_daily_expiry_idx ON public.analytics_admin_daily(day);
CREATE TABLE public.analytics_admin_contributions (
 source text NOT NULL CHECK(source IN ('measurement','engagement')),event_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source,event_id)
);
CREATE INDEX analytics_admin_contribution_expiry_idx ON public.analytics_admin_contributions(recorded_at);
CREATE TABLE public.analytics_admin_rollup_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),last_scan timestamptz NOT NULL,last_full_scan timestamptz NOT NULL
);
CREATE TABLE public.analytics_admin_windows (bucket timestamptz PRIMARY KEY,enabled boolean NOT NULL);
ALTER TABLE public.analytics_admin_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_admin_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_admin_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_admin_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_admin_rollup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_admin_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_admin_members,public.analytics_admin_access_log,public.analytics_admin_daily,
 public.analytics_admin_contributions,public.analytics_admin_rollup_state,public.analytics_admin_windows FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_admin_members,public.analytics_admin_access_log,public.analytics_admin_daily,
 public.analytics_admin_contributions,public.analytics_admin_rollup_state,public.analytics_admin_windows TO service_role;

-- Bounded cohort queries use server-side aggregates, without PostgREST row caps or raw payloads.
CREATE INDEX analytics_admin_ingest_created_idx ON public.ingest_requests(created_at);
CREATE INDEX analytics_admin_import_created_idx ON public.user_imports(created_at);
CREATE INDEX analytics_admin_source_created_idx ON public.content_sources(created_at);
CREATE INDEX analytics_admin_profile_created_idx ON public.users(created_at);
CREATE INDEX analytics_admin_collection_published_idx ON public.collections(published_at) WHERE status='published' AND deleted_at IS NULL;

CREATE FUNCTION public.analytics_admin_authorized(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.analytics_admin_members m JOIN public.users u ON u.id=m.user_id
  WHERE m.user_id=p_user_id AND m.enabled AND u.deleted_at IS NULL AND u.account_status='ACTIVE');
$$;
CREATE FUNCTION public.analytics_admin_account_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.account_status='DELETED' OR NEW.deleted_at IS NOT NULL THEN
  DELETE FROM public.analytics_admin_members WHERE user_id=NEW.id;
  UPDATE public.analytics_admin_access_log SET admin_id=NULL WHERE admin_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER analytics_admin_soft_delete AFTER UPDATE OF account_status,deleted_at ON public.users
 FOR EACH ROW EXECUTE FUNCTION public.analytics_admin_account_erasure();
CREATE FUNCTION public.analytics_admin_retention() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-admin-rollup',0));
 DELETE FROM public.analytics_admin_daily WHERE day<(now() AT TIME ZONE 'UTC')::date-interval '13 months';
 DELETE FROM public.analytics_admin_windows WHERE bucket<now()-interval '13 months';
 DELETE FROM public.analytics_admin_contributions WHERE recorded_at<least(now()-interval '9 days',
  coalesce((SELECT last_scan-interval '7 days' FROM public.analytics_admin_rollup_state WHERE singleton),'-infinity'::timestamptz));
 DELETE FROM public.analytics_admin_access_log WHERE accessed_at<now()-interval '30 days';
END; $$;
CREATE FUNCTION public.analytics_rollup_admin(p_measurement_enabled boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE previous_scan timestamptz;full_scan_at timestamptz;scan_start timestamptz;scan_end timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-admin-rollup',0));scan_end:=clock_timestamp();
 SELECT last_scan,last_full_scan INTO previous_scan,full_scan_at FROM public.analytics_admin_rollup_state WHERE singleton;
 scan_start:=coalesce(previous_scan-interval '15 minutes','-infinity'::timestamptz);
 IF full_scan_at IS NULL OR full_scan_at<scan_end-interval '1 day' THEN
  scan_start:=least(scan_start,scan_end-interval '7 days');full_scan_at:=scan_end;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT 'measurement'::text AS source,e.event_id,(e.occurred_at AT TIME ZONE 'UTC')::date AS day,
   e.event_name,e.platform,e.properties,
   CASE WHEN cp.category IN ('sports','fashion','beauty','electronics','home','food','automotive','outdoors','gaming','travel')
    THEN cp.category ELSE 'other' END AS category
  FROM public.analytics_events e LEFT JOIN public.catalog_products cp ON e.entity_type='product' AND e.namespace='catalog' AND cp.id=e.entity_id
  WHERE e.received_at>=scan_start AND e.received_at<=scan_end
   AND e.occurred_at>=(scan_end AT TIME ZONE 'UTC')::date-interval '13 months'
  UNION ALL
  SELECT 'engagement',f.event_id,(f.occurred_at AT TIME ZONE 'UTC')::date,
   CASE WHEN f.object_type='collection' AND f.interaction_type IN ('save','unsave','share') THEN 'fact.'||f.interaction_type
    WHEN f.object_type='creator' AND f.interaction_type IN ('follow','unfollow') THEN 'fact.'||f.interaction_type
    WHEN f.object_type='reel' AND f.interaction_type IN ('like','unlike') THEN 'fact.'||f.interaction_type END,
   NULL,'{}'::jsonb,NULL
  FROM public.engagement_interaction_facts f WHERE f.created_at>=scan_start AND f.created_at<=scan_end
   AND f.occurred_at>=(scan_end AT TIME ZONE 'UTC')::date-interval '13 months'
   AND ((f.object_type='collection' AND f.interaction_type IN ('save','unsave','share'))
    OR (f.object_type='creator' AND f.interaction_type IN ('follow','unfollow'))
    OR (f.object_type='reel' AND f.interaction_type IN ('like','unlike')))
 ), inserted AS (
  INSERT INTO public.analytics_admin_contributions(source,event_id,recorded_at)
  SELECT source,event_id,scan_end FROM candidates ON CONFLICT DO NOTHING RETURNING source,event_id
 ), expanded AS (
  SELECT c.day,m.metric,d.dimension,m.value FROM candidates c JOIN inserted i USING(source,event_id)
  CROSS JOIN LATERAL (VALUES
   ('app_sessions',CASE WHEN c.event_name='session.started' THEN 1 END),
   ('collection_opens',CASE WHEN c.event_name='collection.opened' THEN 1 END),
   ('collection_impressions',CASE WHEN c.event_name='collection.impression' THEN 1 END),
   ('product_opens',CASE WHEN c.event_name='product.opened' THEN 1 END),
   ('product_impressions',CASE WHEN c.event_name='product.impression' THEN 1 END),
   ('place_impressions',CASE WHEN c.event_name='place.impression' THEN 1 END),
   ('place_outbound_requests',CASE WHEN c.event_name='place.outbound_requested' THEN 1 END),
   ('profile_opens',CASE WHEN c.event_name='creator.profile_opened' THEN 1 END),
   ('search_responses',CASE WHEN c.event_name='search.results_served' THEN 1 END),
   ('search_zero_matches',CASE WHEN c.event_name='search.results_served' AND (c.properties->>'matching_count')::int=0 THEN 1 END),
   ('search_with_fallback',CASE WHEN c.event_name='search.results_served' AND (c.properties->>'fallback_count')::int>0 THEN 1 END),
   ('search_matching_results',CASE WHEN c.event_name='search.results_served' THEN (c.properties->>'matching_count')::int END),
   ('search_fallback_results',CASE WHEN c.event_name='search.results_served' THEN (c.properties->>'fallback_count')::int END),
   ('search_latency_ms',CASE WHEN c.event_name='search.results_served' THEN (c.properties->>'latency_ms')::int END),
   ('search_clicks',CASE WHEN c.event_name='search.result_clicked' THEN 1 END),
   ('search_click_rank_sum',CASE WHEN c.event_name='search.result_clicked' THEN (c.properties->>'rank')::int+1 END),
   ('merchant_requests',CASE WHEN c.event_name='merchant.outbound_resolved' THEN 1 END),
   ('affiliate_requests',CASE WHEN c.event_name='merchant.outbound_resolved' AND (c.properties->>'affiliate')::boolean THEN 1 END),
   ('saves_added',CASE WHEN c.event_name='fact.save' THEN 1 END),('saves_removed',CASE WHEN c.event_name='fact.unsave' THEN 1 END),
   ('follows_added',CASE WHEN c.event_name='fact.follow' THEN 1 END),('follows_removed',CASE WHEN c.event_name='fact.unfollow' THEN 1 END),
   ('likes_added',CASE WHEN c.event_name='fact.like' THEN 1 END),('likes_removed',CASE WHEN c.event_name='fact.unlike' THEN 1 END),
   ('collection_shares',CASE WHEN c.event_name='fact.share' THEN 1 END)
  ) m(metric,value)
  CROSS JOIN LATERAL (
   SELECT 'all'::text AS dimension UNION SELECT 'platform:'||c.platform WHERE c.source='measurement'
   UNION SELECT 'category:'||c.category WHERE c.event_name IN ('product.opened','product.impression','merchant.outbound_resolved')
   UNION SELECT DISTINCT 'filter:'||v FROM jsonb_array_elements_text(coalesce(c.properties->'filter_keys','[]')) v
    WHERE c.event_name='search.results_served' AND v IN ('creatorId','brand','category','verifiedOnly','recentlyPublished','popular','priceMin','priceMax')
  ) d WHERE m.value IS NOT NULL
 )
 INSERT INTO public.analytics_admin_daily(day,metric,dimension,value)
 SELECT day,metric,dimension,sum(value) FROM expanded GROUP BY day,metric,dimension
 ON CONFLICT(day,metric,dimension) DO UPDATE SET value=public.analytics_admin_daily.value+excluded.value;
 INSERT INTO public.analytics_admin_rollup_state VALUES(true,scan_end,full_scan_at)
 ON CONFLICT(singleton) DO UPDATE SET last_scan=excluded.last_scan,last_full_scan=excluded.last_full_scan;
 INSERT INTO public.analytics_admin_windows VALUES(date_trunc('hour',scan_end)+floor(extract(minute FROM scan_end)/5)*interval '5 minutes',coalesce(p_measurement_enabled,false))
 ON CONFLICT(bucket) DO UPDATE SET enabled=public.analytics_admin_windows.enabled AND excluded.enabled;
 PERFORM public.analytics_admin_retention();
END; $$;

CREATE FUNCTION public.analytics_admin_report(p_admin_id uuid,p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE end_day date:=(now() AT TIME ZONE 'UTC')::date; start_day date; report jsonb;
BEGIN
 IF NOT public.analytics_admin_authorized(p_admin_id) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_days IS NULL OR p_days NOT IN (7,30,90) THEN RAISE EXCEPTION 'Invalid range' USING ERRCODE='22023'; END IF;
 start_day:=end_day-p_days;
 INSERT INTO public.analytics_admin_access_log(admin_id,range_days) VALUES(p_admin_id,p_days);
 WITH source_cohort AS MATERIALIZED (
  SELECT id,processing_status,candidate_count FROM public.content_sources
  WHERE created_at>=start_day::timestamp AT TIME ZONE 'UTC' AND created_at<end_day::timestamp AT TIME ZONE 'UTC'
 ), activity AS MATERIALIZED (
  SELECT e.actor_id,e.received_at FROM public.analytics_events e
  JOIN public.analytics_preferences p ON p.user_id=e.actor_id AND p.measurement_enabled AND p.activity_enabled
  JOIN public.users u ON u.id=e.actor_id AND u.account_status='ACTIVE' AND u.deleted_at IS NULL
  WHERE e.received_at>=now()-interval '7 days' AND e.received_at<=now()
 )
 SELECT jsonb_build_object('days',p_days,'end_day',end_day,'generated_at',now(),
  'refreshed_at',(SELECT last_scan FROM public.analytics_admin_rollup_state WHERE singleton),
  'daily',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY day,metric) FROM public.analytics_admin_daily d WHERE day>=end_day-p_days*2 AND day<end_day AND dimension='all'),'[]'),
  'breakdowns',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM (SELECT metric,dimension,sum(value) AS value FROM public.analytics_admin_daily
   WHERE day>=start_day AND day<end_day AND dimension<>'all' GROUP BY metric,dimension) b),'[]'),
  'coverage',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT (bucket AT TIME ZONE 'UTC')::date AS day,count(*) FILTER(WHERE enabled) AS windows
   FROM public.analytics_admin_windows WHERE bucket>=(end_day-p_days*2)::timestamp AT TIME ZONE 'UTC' AND bucket<end_day::timestamp AT TIME ZONE 'UTC' GROUP BY 1) a),'[]'),
  'health',coalesce((SELECT jsonb_agg(to_jsonb(h)) FROM public.analytics_health_daily h WHERE day>=start_day AND day<end_day
   AND metric IN ('accepted','duplicates','invalid_or_ineligible','payload_rejected_batches','rate_limited_events','write_failed_batches')),'[]'),
  'activity',jsonb_build_object('active_24h',(SELECT count(DISTINCT actor_id) FROM activity WHERE received_at>=now()-interval '24 hours'),
   'active_7d',(SELECT count(DISTINCT actor_id) FROM activity),
   'windows_24h',(SELECT count(*) FROM public.analytics_admin_windows WHERE enabled AND bucket>now()-interval '24 hours' AND bucket<=now()),
   'windows_7d',(SELECT count(*) FROM public.analytics_admin_windows WHERE enabled AND bucket>now()-interval '7 days' AND bucket<=now())),
  'snapshot',jsonb_build_object('profiles_current',(SELECT count(*) FROM public.users WHERE deleted_at IS NULL AND account_status<>'DELETED'),
   'active_creators_current',(SELECT count(*) FROM public.users WHERE deleted_at IS NULL AND account_status='ACTIVE' AND creator_status='ACTIVE'),
   'profiles_created_in_range',(SELECT count(*) FROM public.users WHERE deleted_at IS NULL AND account_status<>'DELETED' AND created_at>=start_day::timestamp AT TIME ZONE 'UTC' AND created_at<end_day::timestamp AT TIME ZONE 'UTC'),
   'public_collections_current',(SELECT count(*) FROM public.collections WHERE status='published' AND visibility='public' AND moderation_state='clear' AND deleted_at IS NULL),
   'publications_in_range',(SELECT count(*) FROM public.collections WHERE status='published' AND visibility='public' AND moderation_state='clear' AND deleted_at IS NULL AND published_at>=start_day::timestamp AT TIME ZONE 'UTC' AND published_at<end_day::timestamp AT TIME ZONE 'UTC'),
   'publishing_creators_in_range',(SELECT count(DISTINCT creator_id) FROM public.collections WHERE status='published' AND visibility='public' AND moderation_state='clear' AND deleted_at IS NULL AND published_at>=start_day::timestamp AT TIME ZONE 'UTC' AND published_at<end_day::timestamp AT TIME ZONE 'UTC'),
   'catalog_products_current',(SELECT count(*) FROM public.catalog_products WHERE status<>'HIDDEN'),
   'discovered_products_current',(SELECT count(*) FROM public.discovered_products WHERE internal_status='ACTIVE'),
   'place_records_current',(SELECT count(*) FROM public.places),
   'bag_memberships_current',(SELECT count(*) FROM public.cart_items),'place_saves_current',(SELECT count(*) FROM public.user_place_saves),
   'imports_in_range',(SELECT count(*) FROM public.user_imports WHERE created_at>=start_day::timestamp AT TIME ZONE 'UTC' AND created_at<end_day::timestamp AT TIME ZONE 'UTC'),
   'imports_timed_out_in_range',(SELECT count(*) FROM public.user_imports WHERE timed_out_at IS NOT NULL AND created_at>=start_day::timestamp AT TIME ZONE 'UTC' AND created_at<end_day::timestamp AT TIME ZONE 'UTC'),
   'open_sources_older_15m',(SELECT count(*) FROM public.content_sources WHERE processing_status IN ('RECEIVED','QUEUED','PROCESSING') AND created_at<now()-interval '15 minutes')),
  'source_statuses',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT CASE WHEN processing_status IN ('RECEIVED','QUEUED','PROCESSING','READY','FAILED') THEN processing_status ELSE 'OTHER' END AS status,count(*) AS value FROM source_cohort GROUP BY 1) a),'[]'),
  'ingest_statuses',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT CASE WHEN status IN ('draft','pending','processing','extracting','ready_for_review','published','failed','rejected','completed','dead_letter') THEN status ELSE 'other' END AS status,count(*) AS value FROM public.ingest_requests WHERE created_at>=start_day::timestamp AT TIME ZONE 'UTC' AND created_at<end_day::timestamp AT TIME ZONE 'UTC' GROUP BY 1) a),'[]'),
  'extraction',jsonb_build_object('ready_with_products',(SELECT count(*) FROM source_cohort WHERE processing_status='READY' AND candidate_count>0),
   'ready_without_products',(SELECT count(*) FROM source_cohort WHERE processing_status='READY' AND candidate_count=0),
   'product_candidates',(SELECT count(*) FROM public.content_source_products p JOIN source_cohort c ON c.id=p.content_source_id),
   'bound_product_candidates',(SELECT count(*) FROM public.content_source_products p JOIN source_cohort c ON c.id=p.content_source_id WHERE p.catalog_product_id IS NOT NULL OR p.discovered_product_id IS NOT NULL),
   'place_candidates',(SELECT count(*) FROM public.content_source_places p JOIN source_cohort c ON c.id=p.content_source_id),
   'resolved_places',(SELECT count(*) FROM public.content_source_places p JOIN source_cohort c ON c.id=p.content_source_id WHERE p.resolution_state='resolved')),
  'reconciliation',(SELECT jsonb_build_object('checked_at',checked_at,'collection_mismatches',result->'collection_mismatches','user_mismatches',result->'user_mismatches') FROM public.engagement_reconciliation_runs ORDER BY checked_at DESC LIMIT 1)
 ) INTO report;
 RETURN report;
END; $$;
ALTER FUNCTION public.analytics_maintenance() RENAME TO analytics_maintenance_v3;
CREATE FUNCTION public.analytics_maintenance() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM public.analytics_admin_retention();
 RETURN public.analytics_maintenance_v3();
END; $$;
REVOKE ALL ON FUNCTION public.analytics_admin_authorized(uuid),public.analytics_admin_retention(),public.analytics_rollup_admin(boolean),public.analytics_admin_report(uuid,integer),public.analytics_maintenance() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.analytics_admin_account_erasure() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_admin_authorized(uuid),public.analytics_admin_retention(),public.analytics_rollup_admin(boolean),public.analytics_admin_report(uuid,integer),public.analytics_maintenance() TO service_role;
