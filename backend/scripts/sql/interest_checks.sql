SET timezone='UTC';
CREATE FUNCTION public.test_interest_feature(p_kind text,p_key text,p_ns text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('kind',p_kind,'key',p_key,'namespace',p_ns,'explicit_sources','[]'::jsonb,'explicit_score',0,'inferred_score',2,'score',2,
 'evidence_days',2,'evidence_entities',1,'last_day',(now() AT TIME ZONE 'UTC')::date::text,'confidence','supported');
$$;
INSERT INTO auth.users VALUES('40000000-0000-4000-8000-000000000001'),('40000000-0000-4000-8000-000000000002'),('40000000-0000-4000-8000-000000000003');
INSERT INTO public.users(id,creator_status) SELECT id,'ACTIVE' FROM auth.users WHERE id::text LIKE '40000000%';
INSERT INTO public.catalog_products(id,name,category) VALUES('40000000-0000-4000-8000-000000000020','private product title','electronics'),('40000000-0000-4000-8000-000000000021','hidden product','private health category');
INSERT INTO public.discovered_products(id,name,category) VALUES('40000000-0000-4000-8000-000000000020','private discovered name','fashion'),('40000000-0000-4000-8000-000000000023','other account product','home');
INSERT INTO public.cart_items(id,user_id,catalog_product_id,discovered_product_id) VALUES
 (gen_random_uuid(),'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000020',NULL),
 (gen_random_uuid(),'40000000-0000-4000-8000-000000000001',NULL,'40000000-0000-4000-8000-000000000020'),
 (gen_random_uuid(),'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000021',NULL),
 (gen_random_uuid(),'40000000-0000-4000-8000-000000000002',NULL,'40000000-0000-4000-8000-000000000023');
INSERT INTO public.collections(id,creator_id,visibility) VALUES
 ('40000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000003','public'),
 ('40000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000003','private'),
 ('40000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000001','public');
INSERT INTO public.engagement_relationship_edges(user_id,edge_type,object_type,object_id,state) VALUES
 ('40000000-0000-4000-8000-000000000001','FOLLOW','creator','40000000-0000-4000-8000-000000000003','ACTIVE'),
 ('40000000-0000-4000-8000-000000000001','SAVE','collection','40000000-0000-4000-8000-000000000010','ACTIVE'),
 ('40000000-0000-4000-8000-000000000001','HIDE','catalog_product','40000000-0000-4000-8000-000000000021','ACTIVE');
SELECT (public.test_set_preferences('40000000-0000-4000-8000-000000000001',true,true)).user_id IS NOT NULL AS ready;
SELECT (public.test_set_preferences('40000000-0000-4000-8000-000000000002',true,true)).user_id IS NOT NULL AS ready;
DO $$ DECLARE p public.analytics_preferences;r jsonb;features jsonb;old_epoch uuid;old_measurement uuid;BEGIN
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id='40000000-0000-4000-8000-000000000001';
 old_measurement:=p.revision;
 PERFORM public.test_assert(public.analytics_interest_source(p.user_id) IS NULL,'no profiling without separate purpose opt-in');
 BEGIN PERFORM public.analytics_set_personalization(p.user_id,true,gen_random_uuid(),p.revision,1);RAISE EXCEPTION 'expected stale consent rejection';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM public.analytics_set_personalization(p.user_id,true,p.personalization_revision,p.revision,1);
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.test_assert(p.personalization_enabled AND p.revision=old_measurement,'purpose opt-in preserves measurement receipt and general preferences');
 -- Simulate an account that opted in three days ago; this is fixture time setup, not a production backfill.
 UPDATE public.analytics_preferences SET personalization_since=now()-interval '3 days' WHERE user_id=p.user_id;
 INSERT INTO public.analytics_events(event_id,event_name,occurred_at,received_at,actor_id,entity_type,entity_id,namespace,surface,platform,app_version,source)
 SELECT gen_random_uuid(),name,now()-age,now()-receipt_age,p.user_id,kind,id,ns,'product','ios','1.0.0','client'
 FROM (VALUES
 ('product.opened','product','40000000-0000-4000-8000-000000000020'::uuid,'catalog',interval '1 day',interval '1 day'),
 ('product.opened','product','40000000-0000-4000-8000-000000000020'::uuid,'catalog',interval '2 days',interval '2 days'),
 ('product.opened','product','40000000-0000-4000-8000-000000000020'::uuid,'catalog',interval '4 days',interval '0 days'),
 ('product.opened','product','40000000-0000-4000-8000-000000000021'::uuid,'catalog',interval '1 day',interval '1 day'),
 ('product.opened','product','40000000-0000-4000-8000-000000000023'::uuid,'discovered',interval '1 day',interval '1 day'),
 ('collection.opened','collection','40000000-0000-4000-8000-000000000011'::uuid,NULL,interval '1 day',interval '1 day'),
 ('collection.opened','collection','40000000-0000-4000-8000-000000000012'::uuid,NULL,interval '1 day',interval '1 day'),
 ('place.impression','place_save',NULL::uuid,NULL,interval '1 day',interval '1 day')
 ) v(name,kind,id,ns,age,receipt_age);
 r:=public.analytics_interest_source(p.user_id);
 PERFORM public.test_assert(jsonb_array_length(r->'events')=2,'only post-opt-in visible permitted events, no old queued action/place/own workspace/hidden/private item');
 PERFORM public.test_assert((SELECT count(*) FROM jsonb_array_elements(r->'current') x WHERE x->>'key'='40000000-0000-4000-8000-000000000020')=2,'catalog/discovered namespace collision remains distinct');
 PERFORM public.test_assert(r::text NOT LIKE '%private product title%' AND r::text NOT LIKE '%private discovered name%' AND r::text NOT LIKE '%private health category%','source minimization no titles or arbitrary category text');
 PERFORM public.test_assert(public.analytics_interest_source('40000000-0000-4000-8000-000000000002') IS NULL,'other account activity opt-in is not personalization opt-in');
 features:=jsonb_build_array(public.test_interest_feature('product','40000000-0000-4000-8000-000000000020','catalog'),
  public.test_interest_feature('product','40000000-0000-4000-8000-000000000023','discovered'),
  public.test_interest_feature('collection','40000000-0000-4000-8000-000000000011'),public.test_interest_feature('creator','40000000-0000-4000-8000-000000000003'));
 PERFORM public.test_assert(public.analytics_interest_store(p.user_id,p.personalization_revision,features),'consented profile commits');
 PERFORM public.test_assert(NOT public.analytics_interest_store(p.user_id,p.personalization_revision,features,false,clock_timestamp()-interval '10 minutes'),'delayed source cannot be labelled as a fresh build');
 PERFORM public.test_assert(NOT public.analytics_interest_store(p.user_id,p.personalization_revision,features,false,(SELECT built_at-interval '1 second' FROM public.analytics_interest_profiles WHERE user_id=p.user_id)),'older concurrent source cannot overwrite newer snapshot');
 r:=public.analytics_interest_read(p.user_id);
 PERFORM public.test_assert(r->>'status'='ready' AND jsonb_array_length(r->'features')=2,'store/read exclude inaccessible references and preserve supported/explicit sources');
 PERFORM public.test_assert(r::text NOT LIKE '%actor_id%' AND r::text NOT LIKE '%session_id%' AND r::text NOT LIKE '%place%' AND r::text NOT LIKE '%playback%','snapshot contains no raw contexts or playback');
 PERFORM public.test_assert(NOT public.analytics_interest_store('40000000-0000-4000-8000-000000000002',p.personalization_revision,features),'cannot store A consent epoch under B');
 UPDATE public.engagement_relationship_edges SET state='REMOVED' WHERE user_id=p.user_id AND edge_type='FOLLOW';
 r:=public.analytics_interest_read(p.user_id);
 PERFORM public.test_assert((SELECT (x->>'explicit_score')::int FROM jsonb_array_elements(r->'features') x WHERE x->>'kind'='creator')=0,'current follow removal immediately removes explicit boost');
 INSERT INTO public.engagement_relationship_edges(user_id,edge_type,object_type,object_id,state) VALUES(p.user_id,'HIDE','creator','40000000-0000-4000-8000-000000000003','ACTIVE');
 r:=public.analytics_interest_read(p.user_id);
 PERFORM public.test_assert(jsonb_array_length(r->'features')=1,'read always enforces current hides');
 BEGIN PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,jsonb_build_array(public.test_interest_feature('product','40000000-0000-4000-8000-000000000020','catalog')||'{"query":"sensitive"}'));RAISE EXCEPTION 'expected invalid payload';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,jsonb_build_array(public.test_interest_feature('category','health')));RAISE EXCEPTION 'expected invalid category';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,jsonb_build_array(public.test_interest_feature('product','40000000-0000-4000-8000-000000000020','catalog')||'{"score":null}'));RAISE EXCEPTION 'expected invalid number';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 old_epoch:=p.personalization_revision;
 PERFORM public.analytics_reset_interests(p.user_id);
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id),'reset erases snapshot');
 PERFORM public.test_assert(NOT public.analytics_interest_store(p.user_id,old_epoch,features),'reset prevents an in-flight old worker from restoring erased interests');
 r:=public.analytics_interest_source(p.user_id);
 PERFORM public.test_assert(jsonb_array_length(r->'events')=0 AND jsonb_array_length(r->'current')>0,'reset excludes earlier behavior but preserves current saved intent');
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.test_assert(p.revision=old_measurement,'reset does not rotate measurement receipt');
 PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,features);
 PERFORM public.analytics_set_personalization(p.user_id,false);
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id),'withdrawal immediately removes profile');
 BEGIN PERFORM public.analytics_set_personalization(p.user_id,true,p.personalization_revision,p.revision,1);RAISE EXCEPTION 'expected stale re-enable rejection';EXCEPTION WHEN serialization_failure THEN NULL;END;
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.analytics_set_personalization(p.user_id,true,p.personalization_revision,p.revision,1);
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,features);
 PERFORM public.test_set_preferences(p.user_id,true,false);
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id) AND NOT (SELECT personalization_enabled FROM public.analytics_preferences WHERE user_id=p.user_id),'activity withdrawal cascades purpose and erasure');
 PERFORM public.test_assert((SELECT count(*) FROM public.cart_items WHERE user_id=p.user_id)=3 AND EXISTS(SELECT 1 FROM public.engagement_relationship_edges WHERE user_id=p.user_id AND edge_type='SAVE' AND state='ACTIVE'),'existing transactional saves unchanged');
 PERFORM public.test_set_preferences(p.user_id,true,true);
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.analytics_set_personalization(p.user_id,true,p.personalization_revision,p.revision,1);
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,features);
 UPDATE public.analytics_interest_profiles SET built_at=now()-interval '3 hours' WHERE user_id=p.user_id;
 PERFORM public.test_assert(public.analytics_interest_read(p.user_id)->>'status'='stale','stale profile not served to future consumers');
 UPDATE public.analytics_interest_profiles SET expires_at=now()-interval '1 second' WHERE user_id=p.user_id;
 PERFORM public.analytics_maintenance();
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id),'24h profile expiry in independent maintenance');
 PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,features);
 UPDATE public.users SET deleted_at=now() WHERE id=p.user_id;
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id) AND NOT coalesce((SELECT personalization_enabled FROM public.analytics_preferences WHERE user_id=p.user_id),false),'soft deleted_at also revokes profile purpose');
 UPDATE public.users SET deleted_at=NULL WHERE id=p.user_id;
 -- Restoration requires a fresh explicit general opt-in before a fresh purpose opt-in.
 PERFORM public.test_set_preferences(p.user_id,true,true);
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.analytics_set_personalization(p.user_id,true,p.personalization_revision,p.revision,1);
 SELECT * INTO p FROM public.analytics_preferences WHERE user_id=p.user_id;
 PERFORM public.analytics_interest_store(p.user_id,p.personalization_revision,features);
 UPDATE public.analytics_preferences SET personalization_policy_version=2 WHERE user_id=p.user_id;
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id) AND NOT (SELECT personalization_enabled FROM public.analytics_preferences WHERE user_id=p.user_id),'unknown purpose policy fails closed');
 PERFORM public.test_assert(NOT has_table_privilege('authenticated','public.analytics_interest_profiles','SELECT'),'no browser profile table access');
 PERFORM public.test_assert(NOT has_function_privilege('authenticated','public.analytics_interest_read(uuid)','EXECUTE'),'no self/cross-account RPC bypass');
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.analytics_set_personalization(uuid,boolean,uuid,uuid,integer)','EXECUTE'),'no public consent mutation');
 DELETE FROM auth.users WHERE id=p.user_id;
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id=p.user_id),'hard deletion cascades profile');
END $$;
-- Account for concurrent worker leasing and withdrawal-vs-commit verification in the shell runner.
INSERT INTO auth.users VALUES('40000000-0000-4000-8000-000000000009');
INSERT INTO public.users(id,creator_status) VALUES('40000000-0000-4000-8000-000000000009','ACTIVE');
SELECT (public.test_set_preferences('40000000-0000-4000-8000-000000000009',true,true)).user_id IS NOT NULL AS ready;
SELECT (public.analytics_set_personalization(user_id,true,personalization_revision,revision,1))->>'enabled' AS purpose_ready FROM public.analytics_preferences WHERE user_id='40000000-0000-4000-8000-000000000009';
CREATE TABLE public.scratch_interest_epoch AS SELECT personalization_revision AS epoch FROM public.analytics_preferences WHERE user_id='40000000-0000-4000-8000-000000000009';
CREATE TABLE public.scratch_interest_claims(worker int,ids jsonb);
