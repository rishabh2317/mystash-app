-- Isolated R1–R5 regressions: this transaction is rolled back before other suites.
BEGIN;
CREATE FUNCTION public.readiness_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Readiness regression: %',label;END IF;END $$;
INSERT INTO auth.users VALUES('81000000-0000-4000-8000-000000000001'),('81000000-0000-4000-8000-000000000002');
INSERT INTO public.users(id) SELECT id FROM auth.users;
INSERT INTO public.collections(id,creator_id,views_count) VALUES('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000002',42);
INSERT INTO public.catalog_products(id) VALUES('81000000-0000-4000-8000-000000000004');
DO $$ DECLARE p public.analytics_preferences;old_revision uuid;r jsonb;old_facts bigint; BEGIN
 -- A late increase cannot undo a completed withdrawal, including initial NULL-revision enables.
 p:=public.analytics_set_preferences('81000000-0000-4000-8000-000000000001',true,true);
 old_revision:=p.revision;
 p:=public.analytics_set_preferences(p.user_id,true,false,p.revision,false,true);
 PERFORM public.readiness_assert(p.measurement_enabled AND NOT p.activity_enabled,'partial withdrawal during shutdown');
 BEGIN PERFORM public.analytics_set_preferences(p.user_id,true,true,old_revision);RAISE EXCEPTION 'stale enable accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.analytics_set_preferences(p.user_id,true,true,p.revision,false);RAISE EXCEPTION 'shutdown enable accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 p:=public.analytics_set_preferences(p.user_id,false,false);
 p:=public.analytics_set_preferences(p.user_id,true,false,NULL,false,true);
 PERFORM public.readiness_assert(NOT p.measurement_enabled,'old partial replay cannot re-enable full withdrawal');
 BEGIN PERFORM public.analytics_set_preferences(p.user_id,true,true,NULL);RAISE EXCEPTION 'late initial enable accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 -- R2: a bearer without context/revision must remain unlinked in both merchant stores.
 PERFORM public.analytics_record_legacy_click(p.user_id,NULL,jsonb_build_object('event_id',gen_random_uuid(),'user_id',p.user_id));
 r:=public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','merchant_click','object_type','catalog_product',
  'object_id','81000000-0000-4000-8000-000000000004','catalog_product_id','81000000-0000-4000-8000-000000000004','actor_user_id',p.user_id,'measurement_context',false));
 PERFORM public.readiness_assert(r->'fact'->>'actor_user_id' IS NULL AND r->'fact'->>'session_id' IS NULL,'absent context merchant actor stripped');
 PERFORM public.readiness_assert(NOT EXISTS(SELECT 1 FROM public.product_clicks WHERE user_id=p.user_id),'legacy merchant actor stripped');
 -- R5: the first write bootstraps a missing projection without losing the 42 legacy views.
 r:=public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection','object_id','81000000-0000-4000-8000-000000000003','anonymous_id','readiness'));
 PERFORM public.readiness_assert((SELECT views_count=43 FROM public.collections WHERE id='81000000-0000-4000-8000-000000000003'),'42 plus one is 43');
 PERFORM public.readiness_assert((SELECT value=42 FROM public.engagement_counter_baselines WHERE counter_name='views'),'legacy offset explicit');
 -- Existing authoritative membership is preserved while its projections are initialized.
 INSERT INTO public.engagement_relationship_edges(user_id,edge_type,object_type,object_id,state)
 VALUES(p.user_id,'FOLLOW','creator','81000000-0000-4000-8000-000000000002','ACTIVE');
 UPDATE public.users SET following_count=1 WHERE id=p.user_id;
 UPDATE public.users SET followers_count=1 WHERE id='81000000-0000-4000-8000-000000000002';
 r:=public.engagement_prepare_counter_baselines();
 PERFORM public.readiness_assert((SELECT count(*) FROM public.engagement_relationship_edges)=1 AND
 (SELECT value=1 FROM public.engagement_counter_projections WHERE object_type='user' AND object_id=p.user_id::text AND counter_name='following'),'preparation preserves business membership');
 PERFORM public.readiness_assert((r->>'missing_projections')::int=0 AND (r->>'missing_baselines')::int=0 AND (r->>'blocking_drift')::int=0,'preserving cutover preparation complete');
 PERFORM public.readiness_assert((public.engagement_reconcile()->>'collection_mismatches')::int=0,'reconcile respects historical baseline');
 SELECT count(*) INTO old_facts FROM public.engagement_interaction_facts;
 UPDATE public.engagement_counter_projections SET value=1 WHERE counter_name='views';
 BEGIN
  PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection','object_id','81000000-0000-4000-8000-000000000003','anonymous_id','readiness'));
  RAISE EXCEPTION 'projection drift accepted';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
 END;
 PERFORM public.readiness_assert((SELECT count(*) FROM public.engagement_interaction_facts)=old_facts AND (SELECT views_count=43 FROM public.collections WHERE id='81000000-0000-4000-8000-000000000003'),'drift rolls back fact and mirror');
 BEGIN PERFORM public.engagement_prepare_counter_baselines();RAISE EXCEPTION 'ambiguous preparation accepted';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 UPDATE public.engagement_counter_projections SET value=43 WHERE counter_name='views';
 -- Even matching mirror/projection cannot hide unexpected changes to historical facts.
 UPDATE public.collections SET views_count=44;
 UPDATE public.engagement_counter_projections SET value=44 WHERE counter_name='views';
 BEGIN PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection','object_id','81000000-0000-4000-8000-000000000003','anonymous_id','readiness'));RAISE EXCEPTION 'baseline drift accepted';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 UPDATE public.collections SET views_count=43;
 UPDATE public.engagement_counter_projections SET value=43 WHERE counter_name='views';
 -- R3: deleted_at alone erases all earlier layers; restoring the row cannot restore consent.
 p:=public.analytics_set_preferences(p.user_id,true,true,p.revision);
 PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','save','object_type','collection','object_id','81000000-0000-4000-8000-000000000003','actor_user_id',p.user_id,'measurement_revision',p.revision));
 INSERT INTO public.analytics_events(event_id,event_name,schema_version,occurred_at,session_id,entity_type,entity_id,surface,platform,app_version,properties,actor_id,consent_revision,source)
 VALUES(gen_random_uuid(),'collection.opened',1,now(),gen_random_uuid(),'collection','81000000-0000-4000-8000-000000000003','collection','ios','1.0.0','{}',p.user_id,p.revision,'client');
 UPDATE public.users SET deleted_at=now() WHERE id=p.user_id;
 UPDATE public.users SET deleted_at=now() WHERE id=p.user_id;
 PERFORM public.readiness_assert(NOT EXISTS(SELECT 1 FROM public.analytics_events WHERE actor_id=p.user_id) AND NOT EXISTS(SELECT 1 FROM public.engagement_interaction_facts WHERE actor_user_id=p.user_id),'deleted_at linkage erased idempotently');
 PERFORM public.readiness_assert(NOT EXISTS(SELECT 1 FROM public.analytics_preferences WHERE user_id=p.user_id) AND NOT EXISTS(SELECT 1 FROM public.engagement_relationship_edges WHERE user_id=p.user_id),'deleted_at consent and relationships erased');
 PERFORM public.readiness_assert((public.engagement_reconcile()->>'collection_mismatches')::int=0,'deleted_at stock projection reconciles');
 UPDATE public.users SET deleted_at=NULL WHERE id=p.user_id;
 PERFORM public.readiness_assert(NOT EXISTS(SELECT 1 FROM public.analytics_preferences WHERE user_id=p.user_id),'restore does not restore consent');
 PERFORM public.readiness_assert(NOT has_table_privilege('authenticated','public.engagement_counter_baselines','SELECT') AND NOT has_function_privilege('anon','public.engagement_prepare_counter_baselines()','EXECUTE'),'baseline data and cutover RPC server-only');
 PERFORM public.readiness_assert((SELECT proconfig @> ARRAY['statement_timeout=20s','lock_timeout=2s'] FROM pg_proc WHERE oid='public.analytics_maintenance()'::regprocedure),'scoped SQL deadlines configured');
END $$;
ROLLBACK;
