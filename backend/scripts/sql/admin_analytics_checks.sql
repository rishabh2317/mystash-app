SET timezone='UTC';
SELECT public.test_assert((SELECT count(*) FROM public.analytics_admin_members)=0,'no default admin grants');
INSERT INTO auth.users VALUES('50000000-0000-4000-8000-000000000001'),('50000000-0000-4000-8000-000000000002'),('50000000-0000-4000-8000-000000000003'),('50000000-0000-4000-8000-000000000004');
INSERT INTO public.users(id,creator_status) SELECT id,'ACTIVE' FROM auth.users WHERE id::text LIKE '50000000%';
INSERT INTO public.analytics_admin_members(user_id) VALUES('50000000-0000-4000-8000-000000000001');
DO $$ BEGIN
 PERFORM public.test_assert(public.analytics_admin_authorized('50000000-0000-4000-8000-000000000001'),'explicit member authorized');
 PERFORM public.test_assert(NOT public.analytics_admin_authorized('50000000-0000-4000-8000-000000000002'),'creator is not admin');
 BEGIN PERFORM public.analytics_admin_report('50000000-0000-4000-8000-000000000002',7);RAISE EXCEPTION 'expected denied';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.test_assert((SELECT count(*) FROM public.analytics_admin_access_log)=0,'denied report never logs successful access');
 UPDATE public.analytics_admin_members SET enabled=false;
 PERFORM public.test_assert(NOT public.analytics_admin_authorized('50000000-0000-4000-8000-000000000001'),'revoked membership denied');
 UPDATE public.analytics_admin_members SET enabled=true;
 UPDATE public.users SET account_status='SUSPENDED' WHERE id='50000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT public.analytics_admin_authorized('50000000-0000-4000-8000-000000000001'),'suspended member denied');
 UPDATE public.users SET account_status='ACTIVE' WHERE id='50000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT has_table_privilege('authenticated','public.analytics_admin_members','INSERT'),'no self enrollment');
 PERFORM public.test_assert(NOT has_table_privilege('authenticated','public.analytics_admin_daily','SELECT'),'no public aggregate reads');
 PERFORM public.test_assert(NOT has_table_privilege('anon','public.analytics_admin_access_log','SELECT'),'audit private');
 PERFORM public.test_assert(NOT has_function_privilege('authenticated','public.analytics_admin_report(uuid,integer)','EXECUTE'),'no report RPC bypass');
 PERFORM public.test_assert(NOT has_function_privilege('authenticated','public.analytics_admin_authorized(uuid)','EXECUTE'),'no membership probing RPC');
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.analytics_rollup_admin(boolean)','EXECUTE'),'no public rollup');
END $$;
INSERT INTO public.catalog_products(id,name,category) VALUES('50000000-0000-4000-8000-000000000020','private-title-do-not-return','electronics'),('50000000-0000-4000-8000-000000000021','other-product','private-category-do-not-return');
SELECT (public.analytics_set_preferences('50000000-0000-4000-8000-000000000003',true,true)).user_id IS NOT NULL AS consent_ready;
SELECT (public.analytics_set_preferences('50000000-0000-4000-8000-000000000004',true,true)).user_id IS NOT NULL AS consent_ready;
INSERT INTO public.analytics_events(event_id,event_name,occurred_at,entity_type,entity_id,namespace,surface,platform,app_version,source,properties,actor_id)
SELECT gen_random_uuid(),name,date_trunc('day',now())-interval '12 hours',entity,id,namespace,'search',platform,'1.0.0',source,properties,'50000000-0000-4000-8000-000000000003'
FROM (VALUES
 ('session.started','app',NULL::uuid,NULL,'ios','client','{}'::jsonb),
 ('product.opened','product','50000000-0000-4000-8000-000000000020'::uuid,'catalog','ios','client','{}'::jsonb),
 ('product.impression','product','50000000-0000-4000-8000-000000000021'::uuid,'catalog','web','client','{}'::jsonb),
 ('place.impression','place_save',NULL::uuid,NULL,'android','client','{}'::jsonb),
 ('search.results_served','search',gen_random_uuid(),NULL,'ios','server','{"matching_count":0,"fallback_count":4,"latency_ms":100,"filter_keys":["brand","brand"]}'::jsonb),
 ('search.results_served','search',gen_random_uuid(),NULL,'android','server','{"matching_count":2,"fallback_count":0,"latency_ms":300,"filter_keys":["brand","category"]}'::jsonb),
 ('search.result_clicked','product','50000000-0000-4000-8000-000000000020'::uuid,'catalog','ios','client','{"rank":2}'::jsonb),
 ('merchant.outbound_resolved','product','50000000-0000-4000-8000-000000000020'::uuid,'catalog','ios','server','{"affiliate":true}'::jsonb)
) v(name,entity,id,namespace,platform,source,properties);
INSERT INTO public.analytics_events(event_id,event_name,occurred_at,received_at,entity_type,surface,platform,app_version,source,actor_id)
VALUES(gen_random_uuid(),'session.started',now()-interval '5 days',now()-interval '5 days','app','app','android','1.0.0','client','50000000-0000-4000-8000-000000000004'),
 (gen_random_uuid(),'session.started',now(),now(),'app','app','ios','1.0.0','client','50000000-0000-4000-8000-000000000002'),
 (gen_random_uuid(),'session.started',now(),now(),'app','app','ios','1.0.0','client',NULL);
INSERT INTO public.engagement_interaction_facts(event_id,interaction_type,object_type,object_id,actor_user_id,occurred_at)
VALUES(gen_random_uuid(),'save','collection','50000000-0000-4000-8000-000000000022','50000000-0000-4000-8000-000000000003',date_trunc('day',now())-interval '12 hours'),
 (gen_random_uuid(),'merchant_click','catalog_product','50000000-0000-4000-8000-000000000020','50000000-0000-4000-8000-000000000003',date_trunc('day',now())-interval '12 hours'),
 (gen_random_uuid(),'follow','creator','50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',now()-interval '40 days');
INSERT INTO public.content_sources(id,processing_status,candidate_count,created_at) VALUES
 ('50000000-0000-4000-8000-000000000030','READY',1,now()-interval '2 days'),
 ('50000000-0000-4000-8000-000000000031','READY',0,now()-interval '2 days'),
 ('50000000-0000-4000-8000-000000000032','FAILED',0,now()-interval '2 days'),
 ('50000000-0000-4000-8000-000000000033','PROCESSING',0,now()-interval '2 days'),
 ('50000000-0000-4000-8000-000000000034','FAILED',0,now()),
 ('50000000-0000-4000-8000-000000000035','FAILED',0,now()-interval '100 days');
INSERT INTO public.user_imports(id,user_id,content_source_id,timed_out_at,created_at) VALUES
 (gen_random_uuid(),'50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000030',NULL,now()-interval '2 days'),
 (gen_random_uuid(),'50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000031',now(),now()-interval '2 days');
INSERT INTO public.content_source_products VALUES
 (gen_random_uuid(),'50000000-0000-4000-8000-000000000030','50000000-0000-4000-8000-000000000020',NULL),
 (gen_random_uuid(),'50000000-0000-4000-8000-000000000030',NULL,NULL);
INSERT INTO public.content_source_places VALUES
 (gen_random_uuid(),'50000000-0000-4000-8000-000000000030','resolved'),(gen_random_uuid(),'50000000-0000-4000-8000-000000000030','unresolved');
INSERT INTO public.ingest_requests VALUES(gen_random_uuid(),'failed',now()-interval '2 days'),(gen_random_uuid(),'published',now()-interval '2 days'),(gen_random_uuid(),'private-error-do-not-return',now()-interval '2 days');
SELECT public.analytics_rollup_admin(false);
SELECT public.analytics_rollup_admin(true);
DO $$ DECLARE r jsonb; prior bigint; BEGIN
 r:=public.analytics_admin_report('50000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert((SELECT (v->>'value')::int FROM jsonb_array_elements(r->'daily') v WHERE v->>'metric'='search_responses' AND v->>'dimension'='all')=2,'search responses counted once');
 PERFORM public.test_assert((SELECT (v->>'value')::int FROM jsonb_array_elements(r->'daily') v WHERE v->>'metric'='search_zero_matches' AND v->>'dimension'='all')=1,'fallback does not become matching results');
 PERFORM public.test_assert((SELECT (v->>'value')::int FROM jsonb_array_elements(r->'breakdowns') v WHERE v->>'metric'='search_responses' AND v->>'dimension'='filter:brand')=2,'repeated filter keys do not inflate counters');
 PERFORM public.test_assert((SELECT (v->>'value')::int FROM jsonb_array_elements(r->'daily') v WHERE v->>'metric'='merchant_requests' AND v->>'dimension'='all')=1,'legacy merchant facts not double counted');
 PERFORM public.test_assert((SELECT (v->>'value')::int FROM jsonb_array_elements(r->'breakdowns') v WHERE v->>'metric'='merchant_requests' AND v->>'dimension'='category:electronics')=1,'allowlisted category intelligence');
 PERFORM public.test_assert((r->'activity'->>'active_24h')::int=1 AND (r->'activity'->>'active_7d')::int=2,'opted-in unique accounts, not sessions, with separate windows');
 PERFORM public.test_assert((r->'snapshot'->>'imports_in_range')::int=2 AND (r->'snapshot'->>'imports_timed_out_in_range')::int=1,'cohort import counts');
 PERFORM public.test_assert((r->'extraction'->>'product_candidates')::int=2 AND (r->'extraction'->>'bound_product_candidates')::int=1,'candidate coverage is not correctness');
 PERFORM public.test_assert((r->'extraction'->>'place_candidates')::int=2 AND (r->'extraction'->>'resolved_places')::int=1,'place coverage without locations or names');
 PERFORM public.test_assert((SELECT (v->>'value')::int FROM jsonb_array_elements(r->'source_statuses') v WHERE v->>'status'='FAILED')=1,'source created cohort excludes today and older records');
 PERFORM public.test_assert(jsonb_array_length(r->'coverage')=0,'no fabricated past coverage');
 PERFORM public.test_assert(r::text NOT LIKE '%private-%' AND r::text NOT LIKE '%50000000-%','no raw content, account IDs, arbitrary status/category or private metadata');
 PERFORM public.test_assert((SELECT count(*) FROM public.analytics_admin_access_log)=1,'successful reports audited');
 BEGIN PERFORM public.analytics_admin_report('50000000-0000-4000-8000-000000000001',8);RAISE EXCEPTION 'expected invalid range';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 SELECT sum(value) INTO prior FROM public.analytics_admin_daily;
 INSERT INTO public.analytics_events(event_id,event_name,occurred_at,entity_type,surface,platform,app_version,source)
 VALUES(gen_random_uuid(),'session.started',now()-interval '3 days','app','app','ios','1.0.0','client');
 PERFORM public.analytics_rollup_admin(true);PERFORM public.analytics_rollup_admin(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_admin_daily)=prior+2,'late observation aggregated once in all and platform');
 INSERT INTO public.analytics_events(event_id,event_name,occurred_at,received_at,entity_type,surface,platform,app_version,source)
 VALUES(gen_random_uuid(),'session.started',now()-interval '3 days',now()-interval '2 days','app','app','ios','1.0.0','client');
 UPDATE public.analytics_admin_rollup_state SET last_full_scan=now()-interval '2 days';
 PERFORM public.analytics_rollup_admin(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_admin_daily)=prior+4,'daily catch-up for delayed commits');
 UPDATE public.engagement_interaction_facts SET created_at=now()-interval '10 days' WHERE actor_user_id='50000000-0000-4000-8000-000000000003' AND interaction_type='save';
 UPDATE public.analytics_admin_contributions SET recorded_at=now()-interval '10 days' WHERE source='engagement' AND event_id IN(SELECT event_id FROM public.engagement_interaction_facts WHERE actor_user_id='50000000-0000-4000-8000-000000000003' AND interaction_type='save');
 UPDATE public.analytics_admin_rollup_state SET last_scan=now()-interval '10 days',last_full_scan=now()-interval '10 days';
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert(EXISTS(SELECT 1 FROM public.analytics_admin_contributions WHERE recorded_at<now()-interval '9 days'),'outage preserves overlap keys');
 PERFORM public.analytics_rollup_admin(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_admin_daily)=prior+4,'outage resume idempotent');
 r:=public.analytics_admin_report('50000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert((r->'activity'->>'active_7d')::int=2,'24h correlation expiry does not erase valid seven-day account counting');
 PERFORM public.analytics_set_preferences('50000000-0000-4000-8000-000000000003',false,false);
 r:=public.analytics_admin_report('50000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert((r->'activity'->>'active_24h')::int=0 AND (r->'activity'->>'active_7d')::int=1,'withdrawal immediately removes optional active-account linkage');
 DELETE FROM public.analytics_events;
 PERFORM public.analytics_rollup_admin(false);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_admin_daily)=prior+4,'raw expiry does not erase anonymous aggregates');
 INSERT INTO public.analytics_admin_daily VALUES(current_date-interval '14 months','app_sessions','all',1);
 INSERT INTO public.analytics_admin_access_log(admin_id,accessed_at,range_days) VALUES('50000000-0000-4000-8000-000000000001',now()-interval '31 days',7);
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_admin_daily WHERE day<current_date-interval '13 months'),'aggregate retention independent of collection');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_admin_access_log WHERE accessed_at<now()-interval '30 days'),'access log retention');
 UPDATE public.users SET account_status='DELETED' WHERE id='50000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT public.analytics_admin_authorized('50000000-0000-4000-8000-000000000001'),'soft-deleted admin denied');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_admin_access_log WHERE admin_id IS NOT NULL),'soft-deleted admin audit identity unlinked');
 UPDATE public.users SET account_status='ACTIVE' WHERE id='50000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT public.analytics_admin_authorized('50000000-0000-4000-8000-000000000001'),'restoring account does not restore deleted admin grant');
 INSERT INTO public.analytics_admin_members(user_id) VALUES('50000000-0000-4000-8000-000000000001');
 DELETE FROM auth.users WHERE id='50000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT public.analytics_admin_authorized('50000000-0000-4000-8000-000000000001'),'deleted admin denied and membership cascades');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_admin_access_log WHERE admin_id IS NOT NULL),'deleted admin access log identity unlinked');
END $$;
