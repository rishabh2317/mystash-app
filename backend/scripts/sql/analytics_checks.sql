CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label;END IF;END $$;
-- Setup helper always supplies the revision just read. Stale requests are tested separately.
CREATE FUNCTION public.test_set_preferences(u uuid,m boolean,a boolean) RETURNS public.analytics_preferences LANGUAGE sql AS $$
 SELECT public.analytics_set_preferences(u,m,a,(SELECT revision FROM public.analytics_preferences WHERE user_id=u)); $$;
INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
INSERT INTO public.users(id) SELECT id FROM auth.users;
INSERT INTO public.collections(id,creator_id) VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
INSERT INTO public.catalog_products(id) VALUES('30000000-0000-4000-8000-000000000001');
INSERT INTO public.user_place_saves(id,user_id) VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
CREATE FUNCTION public.test_event(event uuid,name text,kind text,target uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('event_id',event,'event_name',name,'entity_type',kind,'entity_id',target,
 'session_id','50000000-0000-4000-8000-000000000001','occurred_at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'schema_version',1,'surface','collection','platform','ios','app_version','1.0.0','properties','{}'::jsonb)); $$;
DO $$ DECLARE p public.analytics_preferences;r jsonb;e jsonb;old_revision uuid;other_pref public.analytics_preferences;n int; BEGIN
 PERFORM public.test_assert(NOT has_table_privilege('authenticated','public.analytics_events','SELECT'),'raw client reads denied');
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.analytics_ingest(uuid,uuid,jsonb,text,jsonb)','EXECUTE'),'direct RPC denied');
 e:=public.test_event(gen_random_uuid(),'collection.opened','collection','20000000-0000-4000-8000-000000000001');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',NULL,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'consent_rejected')::boolean,'no implicit account measurement');
 p:=public.test_set_preferences('10000000-0000-4000-8000-000000000001',true,false);
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e));
 PERFORM public.test_assert(jsonb_array_length(r->'accepted')=1,'aggregate observation accepted');
 PERFORM public.test_assert((SELECT actor_id IS NULL AND consent_revision IS NULL FROM public.analytics_events WHERE event_id=(e->>'event_id')::uuid),'aggregate has no account linkage');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'duplicates')::int=1,'duplicate acknowledgement');
 e:=jsonb_set(e,'{properties}','{"unexpected":"private"}');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'rejected')::int=1,'immutable payload collision');
 p:=public.test_set_preferences('10000000-0000-4000-8000-000000000001',true,true);
 old_revision:=p.revision;
 e:=public.test_event(gen_random_uuid(),'place.impression','place_save','40000000-0000-4000-8000-000000000001');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e));
 PERFORM public.test_assert((SELECT actor_id IS NOT NULL FROM public.analytics_events WHERE event_id=(e->>'event_id')::uuid),'separate activity opt-in');
 PERFORM public.test_set_preferences('10000000-0000-4000-8000-000000000001',false,false);
 PERFORM public.test_assert((SELECT actor_id IS NULL AND entity_id IS NULL AND session_id IS NULL FROM public.analytics_events WHERE event_id=(e->>'event_id')::uuid),'withdrawal strips private linkage');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',old_revision,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'consent_rejected')::boolean,'stale consent cannot upload');
 UPDATE public.collections SET visibility='private';
 e:=public.test_event(gen_random_uuid(),'collection.opened','collection','20000000-0000-4000-8000-000000000001');
 r:=public.analytics_ingest(NULL,NULL,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'rejected')::int=1,'anonymous private content denied');
 UPDATE public.collections SET visibility='public';
 p:=public.test_set_preferences('10000000-0000-4000-8000-000000000001',true,true);
 -- Existing authoritative facts get app-session context only under activity consent.
 r:=public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','save','object_type','collection',
 'object_id','20000000-0000-4000-8000-000000000001','actor_user_id','10000000-0000-4000-8000-000000000001',
 'session_id','50000000-0000-4000-8000-000000000001','measurement_revision',p.revision));
 PERFORM public.test_assert(r->'fact'->>'session_id'='50000000-0000-4000-8000-000000000001','consented action attribution');

 -- Optional merchant identity is checked and erased under the consent lock in both stores.
 PERFORM public.analytics_record_legacy_click('10000000-0000-4000-8000-000000000001',p.revision,
  '{"event_id":"70000000-0000-4000-8000-000000000001"}'::jsonb);
 PERFORM public.test_assert((SELECT user_id IS NOT NULL FROM public.product_clicks WHERE event_id='70000000-0000-4000-8000-000000000001'),'consented legacy click identity');
 r:=public.engagement_commit(jsonb_build_object('event_id','70000000-0000-4000-8000-000000000002','interaction_type','merchant_click','object_type','catalog_product',
  'object_id','30000000-0000-4000-8000-000000000001','catalog_product_id','30000000-0000-4000-8000-000000000001',
  'actor_user_id','10000000-0000-4000-8000-000000000001','measurement_context',true,'measurement_revision',p.revision));
 PERFORM public.test_assert(r->'fact'->>'actor_user_id' IS NOT NULL,'consented merchant identity');
 old_revision:=p.revision;
 PERFORM public.test_set_preferences('10000000-0000-4000-8000-000000000001',true,false);
 PERFORM public.test_assert((SELECT user_id IS NULL FROM public.product_clicks WHERE event_id='70000000-0000-4000-8000-000000000001'),'legacy click unlink on activity withdrawal');
 PERFORM public.test_assert((SELECT actor_user_id IS NULL FROM public.engagement_interaction_facts WHERE event_id='70000000-0000-4000-8000-000000000002'),'merchant fact unlink on activity withdrawal');
 PERFORM public.analytics_record_legacy_click('10000000-0000-4000-8000-000000000001',old_revision,
  '{"event_id":"70000000-0000-4000-8000-000000000003"}'::jsonb);
 PERFORM public.test_assert((SELECT user_id IS NULL FROM public.product_clicks WHERE event_id='70000000-0000-4000-8000-000000000003'),'stale legacy click cannot relink');
 p:=public.test_set_preferences('10000000-0000-4000-8000-000000000001',true,true);
 -- A client cannot manufacture the authoritative outbound event.
 e:=public.test_event(gen_random_uuid(),'merchant.outbound_resolved','product','30000000-0000-4000-8000-000000000001')||'{"namespace":"catalog"}'::jsonb;
 r:=public.analytics_ingest(NULL,NULL,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'rejected')::int=1,'client authoritative event denied');
 -- Only a returned result, at its recorded rank and in the same session, is a valid click.
 e:=public.test_event('60000000-0000-4000-8000-000000000001','search.results_served','search','60000000-0000-4000-8000-000000000001');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e),'server',
 '[{"id":"30000000-0000-4000-8000-000000000001","entity_type":"product","rank":0}]');
 e:=public.test_event(gen_random_uuid(),'search.result_clicked','product','30000000-0000-4000-8000-000000000001')||
 '{"namespace":"catalog","properties":{"request_id":"60000000-0000-4000-8000-000000000001","rank":0,"result_type":"product"}}'::jsonb;
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e));
 PERFORM public.test_assert(jsonb_array_length(r->'accepted')=1,'verified search click');
 e:=e||jsonb_build_object('event_id',gen_random_uuid(),'properties',(e->'properties')||'{"rank":7}'::jsonb);
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000001',p.revision,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'rejected')::int=1,'fabricated result rank denied');
 other_pref:=public.test_set_preferences('10000000-0000-4000-8000-000000000002',true,true);
 e:=public.test_event(gen_random_uuid(),'place.impression','place_save','40000000-0000-4000-8000-000000000001');
 r:=public.analytics_ingest('10000000-0000-4000-8000-000000000002',other_pref.revision,jsonb_build_array(e));
 PERFORM public.test_assert((r->>'rejected')::int=1,'other-account private membership denied');
 UPDATE public.users SET account_status='DELETED' WHERE id='10000000-0000-4000-8000-000000000001';
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_events WHERE actor_id='10000000-0000-4000-8000-000000000001'),'soft deletion actor erasure');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_preferences WHERE user_id='10000000-0000-4000-8000-000000000001'),'soft deletion consent erasure');
 DELETE FROM auth.users WHERE id='10000000-0000-4000-8000-000000000001';
 e:=public.test_event(gen_random_uuid(),'collection.opened','collection','20000000-0000-4000-8000-000000000001');
 PERFORM public.analytics_ingest('10000000-0000-4000-8000-000000000002',other_pref.revision,jsonb_build_array(e));

 PERFORM public.analytics_record_legacy_click('10000000-0000-4000-8000-000000000002',other_pref.revision,
  '{"event_id":"80000000-0000-4000-8000-000000000001"}'::jsonb);
 UPDATE public.product_clicks SET created_at=now()-interval '8 days' WHERE event_id='80000000-0000-4000-8000-000000000001';
 r:=public.engagement_commit(jsonb_build_object('event_id','80000000-0000-4000-8000-000000000002','interaction_type','merchant_click','object_type','catalog_product',
  'object_id','30000000-0000-4000-8000-000000000001','catalog_product_id','30000000-0000-4000-8000-000000000001',
  'actor_user_id','10000000-0000-4000-8000-000000000002','measurement_context',true,'measurement_revision',other_pref.revision));
 UPDATE public.engagement_interaction_facts SET created_at=now()-interval '8 days' WHERE event_id='80000000-0000-4000-8000-000000000002';
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert((SELECT user_id IS NULL FROM public.product_clicks WHERE event_id='80000000-0000-4000-8000-000000000001'),'legacy identity expiry');
 PERFORM public.test_assert((SELECT actor_user_id IS NULL FROM public.engagement_interaction_facts WHERE event_id='80000000-0000-4000-8000-000000000002'),'merchant identity expiry');
 DELETE FROM auth.users WHERE id='10000000-0000-4000-8000-000000000002';
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_events WHERE actor_id IS NOT NULL),'direct hard-delete erasure');
 PERFORM public.engagement_commit_v1(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection',
  'object_id','20000000-0000-4000-8000-000000000001','anonymous_id','expiry-fixture','session_id','50000000-0000-4000-8000-000000000001'));
 UPDATE public.engagement_interaction_facts SET created_at=now()-interval '2 days';
 UPDATE public.analytics_events SET received_at=now()-interval '2 days';
 UPDATE public.analytics_search_results SET created_at=now()-interval '2 days';
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert(EXISTS(SELECT 1 FROM public.analytics_events),'24-hour cleanup preserves aggregate observations');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_events WHERE session_id IS NOT NULL),'24-hour session expiry');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.engagement_interaction_facts WHERE session_id IS NOT NULL),'transaction context expiry');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_search_results),'24-hour search-result expiry');
 UPDATE public.analytics_events SET received_at=now()-interval '8 days';
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_events),'raw retention enforced');
 BEGIN
  e:=public.test_event(gen_random_uuid(),'video.watch_summary','video','20000000-0000-4000-8000-000000000001');
  PERFORM public.analytics_ingest(NULL,NULL,jsonb_build_array(e),'client');
  RAISE EXCEPTION 'excluded event accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT count(*) INTO n FROM public.analytics_events;
 PERFORM public.test_assert(n=0,'excluded events leave no records');
END $$;
