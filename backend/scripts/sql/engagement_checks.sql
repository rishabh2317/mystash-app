INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO public.users(id) SELECT id FROM auth.users;
INSERT INTO public.collections(id,creator_id) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002');
CREATE FUNCTION public.test_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT public.test_assert(NOT has_table_privilege('authenticated','public.engagement_interaction_facts','SELECT'),'raw facts grant');
SELECT public.test_assert(NOT has_function_privilege('anon','public.engagement_commit(jsonb)','EXECUTE'),'RPC grant');
DO $$ DECLARE r jsonb; n int; BEGIN
 r:=public.engagement_commit('{"event_id":"10000000-0000-0000-0000-000000000001","interaction_type":"view","object_type":"collection","object_id":"00000000-0000-0000-0000-000000000003","collection_id":"00000000-0000-0000-0000-000000000003","actor_user_id":"00000000-0000-0000-0000-000000000001","creator_id":"00000000-0000-0000-0000-000000000001"}');
 PERFORM public.test_assert((r->>'inserted')::boolean,'first insert');
 PERFORM public.test_assert(r->'fact'->>'creator_id'='00000000-0000-0000-0000-000000000002','server-derived creator');
 r:=public.engagement_commit('{"event_id":"10000000-0000-0000-0000-000000000001","interaction_type":"view","object_type":"collection","object_id":"00000000-0000-0000-0000-000000000003","collection_id":"00000000-0000-0000-0000-000000000003","actor_user_id":"00000000-0000-0000-0000-000000000001"}');
 PERFORM public.test_assert(NOT (r->>'inserted')::boolean,'duplicate acknowledgement');
 BEGIN
  PERFORM public.engagement_commit('{"event_id":"10000000-0000-0000-0000-000000000001","interaction_type":"share","object_type":"collection","object_id":"00000000-0000-0000-0000-000000000003","collection_id":"00000000-0000-0000-0000-000000000003","actor_user_id":"00000000-0000-0000-0000-000000000001"}');
  RAISE EXCEPTION 'conflicting event accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 UPDATE public.collections SET visibility='private';
 BEGIN
  PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection','object_id','00000000-0000-0000-0000-000000000003','anonymous_id','private-test'));
  RAISE EXCEPTION 'private collection visible';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 UPDATE public.collections SET visibility='public';
 SELECT count(*) INTO n FROM public.engagement_interaction_facts;
 -- A mirror overflow occurs after fact insertion; the entire call must roll back.
 UPDATE public.collections SET views_count=2147483647;
 UPDATE public.engagement_counter_baselines SET value=2147483646 WHERE counter_name='views';
 UPDATE public.engagement_counter_projections SET value=2147483647 WHERE counter_name='views';
 BEGIN
  PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection','object_id','00000000-0000-0000-0000-000000000003','anonymous_id','rollback-test'));
  RAISE EXCEPTION 'overflow did not fail';
 EXCEPTION WHEN numeric_value_out_of_range THEN NULL; END;
 PERFORM public.test_assert((SELECT count(*) FROM public.engagement_interaction_facts)=n,'fact rollback');
 UPDATE public.collections SET views_count=1;
 UPDATE public.engagement_counter_baselines SET value=0 WHERE counter_name='views';
 UPDATE public.engagement_counter_projections SET value=1 WHERE counter_name='views';
 INSERT INTO public.engagement_counter_projections(object_type,object_id,counter_name,value)
 VALUES('collection','00000000-0000-0000-0000-000000000003','saves',2147483647);
 UPDATE public.collections SET saves_count=2147483647;
 BEGIN
  PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','save','object_type','collection',
   'object_id','00000000-0000-0000-0000-000000000003','actor_user_id','00000000-0000-0000-0000-000000000001'));
  RAISE EXCEPTION 'save stock drift did not fail';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 PERFORM public.test_assert((SELECT count(*) FROM public.engagement_interaction_facts)=n,'save fact rollback');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.engagement_relationship_edges WHERE edge_type='SAVE'),'edge rollback');
 UPDATE public.collections SET saves_count=0;
 UPDATE public.engagement_counter_projections SET value=0 WHERE counter_name='saves';
 PERFORM public.test_assert((public.engagement_reconcile()->>'collection_mismatches')::int=0,'reconciliation healthy');
 UPDATE public.collections SET views_count=9;
 PERFORM public.test_assert((public.engagement_reconcile()->>'collection_mismatches')::int=1,'reconciliation detects drift');
 UPDATE public.collections SET views_count=1;
 UPDATE public.engagement_counter_baselines SET value=0 WHERE counter_name='views';
END $$;

-- Current-state transitions are distinct from delivery retries.
DO $$ DECLARE r jsonb; BEGIN
 r:=public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','follow','object_type','creator',
  'object_id','00000000-0000-0000-0000-000000000002','actor_user_id','00000000-0000-0000-0000-000000000001'));
 PERFORM public.test_assert((r->>'inserted')::boolean,'follow inserted');
 r:=public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','follow','object_type','creator',
  'object_id','00000000-0000-0000-0000-000000000002','actor_user_id','00000000-0000-0000-0000-000000000001'));
 PERFORM public.test_assert(NOT (r->>'inserted')::boolean,'unchanged follow emits no fact');
 PERFORM public.test_assert((public.engagement_reconcile()->>'user_mismatches')::int=0,'follow mirrors');
END $$;
INSERT INTO public.collections(id,creator_id,title)
 SELECT gen_random_uuid(),'00000000-0000-0000-0000-000000000002','Summary test' FROM generate_series(1,1005);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.engagement_creator_summary('00000000-0000-0000-0000-000000000002');
 PERFORM public.test_assert((r->>'collections_total')::int=1006,'summary counts beyond default row cap');
 PERFORM public.test_assert(jsonb_array_length(r->'collections')=100,'bounded ranked payload');
 PERFORM public.test_assert((r->'totals'->>'views')::int=1,'summary exact totals');
 PERFORM public.test_assert(public.engagement_check_and_record() IS NOT NULL,'durable reconciliation report');
 PERFORM public.test_assert(public.engagement_check_and_record() IS NULL,'replica rate gate');
END $$;
