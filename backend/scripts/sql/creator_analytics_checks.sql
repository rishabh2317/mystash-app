SET timezone='UTC';
INSERT INTO auth.users VALUES('60000000-0000-4000-8000-000000000001'),('60000000-0000-4000-8000-000000000002');
INSERT INTO public.users(id) SELECT id FROM auth.users WHERE id::text LIKE '60000000%';
INSERT INTO public.collections(id,creator_id,title,visibility) VALUES
 ('60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000001','Own public','public'),
 ('60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000002','Other creator','public'),
 ('60000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000001','Private','private');
INSERT INTO public.catalog_products(id,name) VALUES('60000000-0000-4000-8000-000000000020','Catalog product');
INSERT INTO public.discovered_products(id,name) VALUES('60000000-0000-4000-8000-000000000020','Discovered same UUID');
INSERT INTO public.collection_product_tags(id,collection_id,catalog_product_id,discovered_product_id) VALUES
 ('60000000-0000-4000-8000-000000000030','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000020',NULL),
 ('60000000-0000-4000-8000-000000000031','60000000-0000-4000-8000-000000000010',NULL,'60000000-0000-4000-8000-000000000020');
INSERT INTO public.analytics_events(event_id,event_name,occurred_at,entity_type,entity_id,collection_id,creator_id,surface,platform,app_version,source,namespace)
SELECT gen_random_uuid(),event_name,date_trunc('day',now())-interval '1 day'+interval '12 hours',entity_type,entity_id,collection_id,creator_id,'collection','ios','1.0.0',source,namespace
FROM (VALUES
 ('collection.opened','collection','60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000001'::uuid,'client',NULL),
 ('collection.impression','collection','60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000001'::uuid,'client',NULL),
 ('collection.opened','collection','60000000-0000-4000-8000-000000000011'::uuid,'60000000-0000-4000-8000-000000000011'::uuid,'60000000-0000-4000-8000-000000000002'::uuid,'client',NULL),
 ('collection.opened','collection','60000000-0000-4000-8000-000000000012'::uuid,'60000000-0000-4000-8000-000000000012'::uuid,'60000000-0000-4000-8000-000000000001'::uuid,'client',NULL),
 ('creator.profile_opened','creator','60000000-0000-4000-8000-000000000001'::uuid,NULL::uuid,NULL::uuid,'client',NULL),
 ('product.impression','product','60000000-0000-4000-8000-000000000020'::uuid,'60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000001'::uuid,'client','catalog'),
 ('merchant.outbound_resolved','product','60000000-0000-4000-8000-000000000020'::uuid,'60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000001'::uuid,'server','catalog'),
 ('merchant.outbound_resolved','product','60000000-0000-4000-8000-000000000020'::uuid,'60000000-0000-4000-8000-000000000010'::uuid,'60000000-0000-4000-8000-000000000001'::uuid,'server','discovered')
) v(event_name,entity_type,entity_id,collection_id,creator_id,source,namespace);
INSERT INTO public.engagement_interaction_facts(event_id,interaction_type,object_type,object_id,actor_user_id,collection_id,creator_id,occurred_at,created_at)
SELECT gen_random_uuid(),interaction,object_type,object_id,'60000000-0000-4000-8000-000000000002',collection_id,'60000000-0000-4000-8000-000000000001',
 date_trunc('day',now())-age,date_trunc('day',now())-age
FROM (VALUES
 ('save','collection','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010'::uuid,interval '1 day'),
 ('unsave','collection','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010'::uuid,interval '1 day'),
 ('like','reel','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010'::uuid,interval '1 day'),
 ('follow','creator','60000000-0000-4000-8000-000000000001',NULL::uuid,interval '40 days'),
 ('unfollow','creator','60000000-0000-4000-8000-000000000001',NULL::uuid,interval '1 day'),
 ('view','collection','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010'::uuid,interval '1 day'),
 ('merchant_click','catalog_product','60000000-0000-4000-8000-000000000020','60000000-0000-4000-8000-000000000010'::uuid,interval '1 day')
) v(interaction,object_type,object_id,collection_id,age);
SELECT public.analytics_rollup_creators(false);
SELECT public.analytics_rollup_creators(true);
DO $$ DECLARE r jsonb; old_count bigint; BEGIN
 r:=public.analytics_creator_report('60000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert((SELECT (x->>'value')::int FROM jsonb_array_elements(r->'daily') x WHERE x->>'metric'='collection_opens')=1,'repeat rollup exactly once, own public opens only');
 PERFORM public.test_assert((SELECT (x->>'value')::int FROM jsonb_array_elements(r->'daily') x WHERE x->>'metric'='merchant_requests')=2,'merchant observation counted once, no legacy double count');
 PERFORM public.test_assert(jsonb_array_length(r->'top_products')=2,'catalog and discovered namespace identity remain distinct');
 PERFORM public.test_assert(r->'top_collections'->0->>'title'='Own public','full result enrichment, no recent-20 thumbnail lookup');
 PERFORM public.test_assert(jsonb_array_length(r->'coverage')=0,'no fabricated historical coverage');
 PERFORM public.test_assert(EXISTS(SELECT 1 FROM public.analytics_creator_daily WHERE creator_id='60000000-0000-4000-8000-000000000001' AND metric='followers_added'),'first run backfills older facts');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_measurement_windows WHERE bucket=date_trunc('hour',now())+floor(extract(minute FROM now())/5)*interval '5 minutes' AND enabled),'disabled sample cannot be upgraded to known coverage');
 SELECT sum(value) INTO old_count FROM public.analytics_creator_daily;
 -- Late arrival uses server received time, not the older occurred time.
 INSERT INTO public.analytics_events(event_id,event_name,occurred_at,entity_type,entity_id,collection_id,creator_id,surface,platform,app_version,source)
 VALUES(gen_random_uuid(),'collection.opened',now()-interval '3 days','collection','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000001','collection','android','1.0.0','client');
 PERFORM public.analytics_rollup_creators(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_creator_daily)=old_count+1,'late event included once');
 PERFORM public.analytics_rollup_creators(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_creator_daily)=old_count+1,'late event retry idempotent');
 -- A delayed transaction older than the fast overlap is picked up by daily catch-up.
 INSERT INTO public.analytics_events(event_id,event_name,occurred_at,received_at,entity_type,entity_id,collection_id,creator_id,surface,platform,app_version,source)
 VALUES(gen_random_uuid(),'collection.opened',now()-interval '3 days',now()-interval '2 days','collection','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000001','collection','android','1.0.0','client');
 UPDATE public.analytics_rollup_state SET last_full_scan=now()-interval '2 days';
 PERFORM public.analytics_rollup_creators(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_creator_daily)=old_count+2,'daily catch-up includes older commits');
 -- An outage longer than the ordinary ledger TTL must not re-add the last processed overlap.
 UPDATE public.engagement_interaction_facts SET created_at=now()-interval '10 days'
 WHERE actor_user_id='60000000-0000-4000-8000-000000000002' AND interaction_type='save';
 UPDATE public.analytics_creator_contributions SET recorded_at=now()-interval '10 days'
 WHERE source='engagement' AND event_id IN (SELECT event_id FROM public.engagement_interaction_facts
  WHERE actor_user_id='60000000-0000-4000-8000-000000000002' AND interaction_type='save');
 UPDATE public.analytics_rollup_state SET last_scan=now()-interval '10 days',last_full_scan=now()-interval '10 days';
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert(EXISTS(SELECT 1 FROM public.analytics_creator_contributions WHERE recorded_at<now()-interval '9 days'),'outage preserves final overlap dedupe');
 PERFORM public.analytics_rollup_creators(true);
 PERFORM public.test_assert((SELECT sum(value) FROM public.analytics_creator_daily)=old_count+2,'outage resume does not double count');
END $$;
-- Coverage samples have constant cost independent of DAU; previous/current equal-duration ranges.
INSERT INTO public.analytics_measurement_windows(bucket,enabled)
 SELECT s,true FROM generate_series(date_trunc('day',now())-interval '14 days',date_trunc('day',now())-interval '5 minutes',interval '5 minutes') s;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.analytics_creator_report('60000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert(jsonb_array_length(r->'coverage')=14 AND (SELECT min((x->>'windows')::int) FROM jsonb_array_elements(r->'coverage') x)=288,'exact UTC daily coverage');
 BEGIN PERFORM public.analytics_creator_report('60000000-0000-4000-8000-000000000001',8);RAISE EXCEPTION 'expected invalid range';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 UPDATE public.users SET creator_status='NONE' WHERE id='60000000-0000-4000-8000-000000000002';
 BEGIN PERFORM public.analytics_creator_report('60000000-0000-4000-8000-000000000002',7);RAISE EXCEPTION 'expected denied creator';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.test_assert(NOT has_function_privilege('authenticated','public.analytics_creator_report(uuid,integer)','EXECUTE'),'no browser RPC bypass');
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.analytics_rollup_creators(boolean)','EXECUTE'),'no public rollup access');
 PERFORM public.test_assert(NOT has_table_privilege('authenticated','public.analytics_creator_daily','SELECT'),'no raw aggregate cross-creator access');
 UPDATE public.collections SET visibility='private' WHERE id='60000000-0000-4000-8000-000000000010';
 r:=public.analytics_creator_report('60000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert(jsonb_array_length(r->'top_collections')=0 AND jsonb_array_length(r->'top_products')=0,'private content excluded at read time');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'daily') x WHERE x->>'metric' IN ('collection_opens','merchant_requests')),'private metrics excluded at read time');
 UPDATE public.collections SET visibility='public' WHERE id='60000000-0000-4000-8000-000000000010';
 DELETE FROM public.collection_product_tags WHERE collection_id='60000000-0000-4000-8000-000000000010';
 r:=public.analytics_creator_report('60000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert(jsonb_array_length(r->'top_products')=0,'removed attribution excluded');
 -- Raw source expiry leaves anonymous daily aggregates intact.
 DELETE FROM public.analytics_events;
 PERFORM public.analytics_rollup_creators(false);
 r:=public.analytics_creator_report('60000000-0000-4000-8000-000000000001',7);
 PERFORM public.test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(r->'daily') x WHERE x->>'metric'='collection_opens'),'source expiry preserves aggregates');
 INSERT INTO public.analytics_creator_daily VALUES('60000000-0000-4000-8000-000000000001',current_date-interval '14 months','profile_opens','60000000-0000-4000-8000-000000000001','','00000000-0000-0000-0000-000000000000',1);
 INSERT INTO public.analytics_creator_contributions VALUES('measurement',gen_random_uuid(),now()-interval '10 days');
 PERFORM public.analytics_rollup_creators(false);
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_creator_daily WHERE day<current_date-interval '13 months'),'aggregate retention');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_creator_contributions WHERE recorded_at<now()-interval '9 days'),'bounded dedupe ledger');
 DELETE FROM auth.users WHERE id='60000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_creator_daily WHERE creator_id='60000000-0000-4000-8000-000000000001'),'deleted creator aggregate cascade');
END $$;
