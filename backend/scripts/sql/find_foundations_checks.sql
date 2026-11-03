DO $$ DECLARE p regprocedure; BEGIN
 IF (SELECT count(*) FROM cart_items WHERE removed_at IS NULL)<>1 THEN RAISE EXCEPTION 'Historical save lost'; END IF;
 IF (SELECT stash_sync_state FROM user_imports LIMIT 1) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected historical backfill'; END IF;
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'find_%' LOOP
  IF has_function_privilege('anon',p,'EXECUTE') OR has_function_privilege('authenticated',p,'EXECUTE') OR NOT has_function_privilege('service_role',p,'EXECUTE')
  THEN RAISE EXCEPTION 'Unsafe RPC grants: %',p; END IF;
 END LOOP;
END $$;
SELECT 'PASS historical memberships retained; no backfill; new RPCs service-only';

DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111';
 s uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; i uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 p uuid:='33333333-3333-4333-8333-333333333333'; q uuid:='44444444-4444-4444-8444-444444444444';
 d uuid; result jsonb; before_id uuid; h uuid; save_id uuid; canonical uuid; lease uuid:=gen_random_uuid(); revision bigint; BEGIN
 SELECT id INTO before_id FROM cart_items WHERE user_id=u AND catalog_product_id=p;
 PERFORM find_cart_remove(u,p,NULL);
 result:=find_cart_put(u,p,NULL,jsonb_build_object('source_surface','USER_IMPORT','source_user_import_id',i,'source_content_source_id',s),true);
 IF NOT(result->>'suppressed')::boolean THEN RAISE EXCEPTION 'Removal resurrected'; END IF;
 result:=find_cart_put(u,p,NULL,'{}',false);
 IF (result->'item'->>'id')::uuid<>before_id OR (result->>'suppressed')::boolean THEN RAISE EXCEPTION 'Explicit restore failed'; END IF;
 INSERT INTO discovered_products(identity_key,name,catalog_product_id) VALUES('fixture','Fixture product',q) RETURNING id INTO d;
 PERFORM find_cart_put(u,NULL,d,'{}',false); PERFORM find_cart_remove(u,NULL,d);
 result:=find_cart_put(u,q,NULL,jsonb_build_object('source_user_import_id',i,'source_content_source_id',s),true);
 IF NOT(result->>'suppressed')::boolean THEN RAISE EXCEPTION 'Promoted discovered alias resurrected'; END IF;
 PERFORM find_cart_put(u,q,NULL,'{}',false);
 UPDATE cart_items SET explicit_action_at='2000-01-01' WHERE user_id=u AND catalog_product_id=q;
 PERFORM find_cart_remove(u,p,NULL); PERFORM find_cart_remap(p,q);
 IF EXISTS(SELECT 1 FROM cart_items WHERE user_id=u AND catalog_product_id=q AND removed_at IS NULL) THEN RAISE EXCEPTION 'Merge lost removal'; END IF;
 PERFORM find_cart_put(u,q,NULL,'{}',false);

 INSERT INTO content_source_products(content_source_id,external_id,name,extraction_method,processor_version,catalog_product_id)
 VALUES(s,'fixture','Fixture product','cache','fixture',p);
 UPDATE catalog_products SET status='MERGED',merged_into_id=q WHERE id=p;
 IF (SELECT missing_products FROM find_import_memberships(u,ARRAY[i]))<>0 OR
    (SELECT saved_products FROM find_import_memberships(u,ARRAY[i]))<>1 THEN RAISE EXCEPTION 'Merged product not recognized in Stash'; END IF;
 IF NOT EXISTS(SELECT 1 FROM user_imports WHERE id=i AND stash_sync_state='pending') THEN RAISE EXCEPTION 'No durable pending marker'; END IF;
 INSERT INTO content_source_places(content_source_id,extracted_name,resolution_state,unresolved_reason,hypothesis_key)
 VALUES(s,'Fixture cafe','unresolved','ambiguous','fixture') RETURNING id INTO h;
 result:=place_attach_import(u,h,s,i); save_id:=(result->>'id')::uuid;
 IF (SELECT unverified_places FROM find_import_memberships(u,ARRAY[i]))<>1 THEN RAISE EXCEPTION 'Lead outcome count incorrect'; END IF;
 PERFORM find_place_membership(u,save_id,false); PERFORM place_attach_import(u,h,s,i);
 IF NOT EXISTS(SELECT 1 FROM user_place_saves WHERE id=save_id AND removed_at IS NOT NULL) THEN RAISE EXCEPTION 'Place removal resurrected'; END IF;
 IF (SELECT missing_places FROM find_import_memberships(u,ARRAY[i]))<>0 THEN RAISE EXCEPTION 'Removed place counted as missing'; END IF;
 IF (SELECT saved_places FROM find_import_memberships(u,ARRAY[i]))<>0 THEN RAISE EXCEPTION 'Removed place counted as saved'; END IF;
 BEGIN
  PERFORM find_place_membership('22222222-2222-4222-8222-222222222222',save_id,true);
  RAISE EXCEPTION 'Cross-owner restore allowed';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 PERFORM find_retire_place_hypotheses(s,ARRAY[]::text[]);
 IF NOT EXISTS(SELECT 1 FROM user_place_saves WHERE id=save_id AND removed_at IS NOT NULL) THEN RAISE EXCEPTION 'Pruning erased tombstone'; END IF;
 result:=place_upsert_hypothesis(jsonb_build_object('content_source_id',s,'extracted_name','Fixture cafe','hypothesis_key','fixture','unresolved_reason','ambiguous'));
 IF (result->>'id')::uuid<>h OR result->>'retired_at' IS NOT NULL THEN RAISE EXCEPTION 'Reappearance did not reuse evidence'; END IF;
 PERFORM find_place_membership(u,save_id,true);
 INSERT INTO places(provider,provider_place_id,name) VALUES('fixture','canonical','Fixture cafe') RETURNING id INTO canonical;
 PERFORM place_mark_resolved(h,canonical);
 IF (SELECT resolved_places FROM find_import_memberships(u,ARRAY[i]))<>1 OR
    (SELECT unverified_places FROM find_import_memberships(u,ARRAY[i]))<>0 THEN RAISE EXCEPTION 'Promotion outcome counts incorrect'; END IF;
 PERFORM find_place_membership(u,save_id,false);
 -- A second hypothesis for the same canonical place must reuse the removed card.
 INSERT INTO content_source_places(content_source_id,extracted_name,resolution_state,place_id,hypothesis_key)
 VALUES(s,'Fixture cafe alternate','resolved',canonical,'alternate') RETURNING id INTO h;
 result:=place_attach_import(u,h,s,i);
 IF (result->>'id')::uuid<>save_id OR result->>'removed_at' IS NULL THEN RAISE EXCEPTION 'Canonical place restored by another hypothesis'; END IF;

 SELECT stash_sync_revision INTO revision FROM find_claim_stash_sync(lease) WHERE id=i;
 IF revision IS NULL THEN RAISE EXCEPTION 'No sync claim'; END IF;
 UPDATE user_imports SET stash_sync_until=clock_timestamp()-interval '1 second' WHERE id=i;
 IF find_finish_stash_sync(i,lease,revision,true) THEN RAISE EXCEPTION 'Expired acknowledgement accepted'; END IF;
 SELECT stash_sync_revision INTO revision FROM find_claim_stash_sync(lease) WHERE id=i;
 UPDATE content_source_products SET name='Updated product' WHERE content_source_id=s;
 IF find_finish_stash_sync(i,lease,revision,true) THEN RAISE EXCEPTION 'Stale acknowledgement accepted'; END IF;
 SELECT stash_sync_revision INTO revision FROM find_claim_stash_sync(lease) WHERE id=i;
 IF NOT find_finish_stash_sync(i,lease,revision,false) THEN RAISE EXCEPTION 'Failure not persisted'; END IF;
 IF (SELECT stash_sync_state FROM user_imports WHERE id=i)<>'failed' THEN RAISE EXCEPTION 'False completed save'; END IF;
 UPDATE user_imports SET stash_sync_after=now() WHERE id=i;
 SELECT stash_sync_revision INTO revision FROM find_claim_stash_sync(lease) WHERE id=i;
 IF NOT find_finish_stash_sync(i,lease,revision,true) THEN RAISE EXCEPTION 'Recovery could not complete'; END IF;
 UPDATE user_imports SET hidden_at=now() WHERE id=i;
 IF EXISTS(SELECT 1 FROM find_claim_stash_sync(lease) WHERE id=i) THEN RAISE EXCEPTION 'Hidden import claimed'; END IF;
 BEGIN
  PERFORM find_cart_put(u,p,NULL,jsonb_build_object('source_user_import_id',i,'source_content_source_id',s),true);
  RAISE EXCEPTION 'Hidden import materialized';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS removal/restoration; catalog/discovered aliases; source provenance; owner isolation; pruning; recovery CAS and hidden imports';

DO $$ DECLARE s uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; a uuid:=gen_random_uuid(); stamp timestamptz; BEGIN
 UPDATE content_sources SET processing_status='QUEUED' WHERE id=s;
 PERFORM import_work_claim(s,a,'fixture');
 UPDATE content_source_import_progress SET product_status='failed',place_status='failed' WHERE content_source_id=s;
 SELECT finished_at INTO stamp FROM content_source_import_progress WHERE content_source_id=s;
 IF stamp IS NULL THEN RAISE EXCEPTION 'Failed attempt lacks terminal timestamp'; END IF;
 UPDATE content_source_import_progress SET product_status='failed' WHERE content_source_id=s;
 IF (SELECT finished_at FROM content_source_import_progress WHERE content_source_id=s)<>stamp THEN RAISE EXCEPTION 'Replay changed terminal time'; END IF;
 PERFORM import_work_release(s,a);
 UPDATE content_sources SET processing_status='READY' WHERE id=s;
END $$;
SELECT 'PASS terminal timestamps are persisted and stable on replay';

DO $$ BEGIN
 IF find_schema_version()<>1 THEN RAISE EXCEPTION 'Incompatible Find schema'; END IF;
 IF has_table_privilege('authenticated','public.cart_items','DELETE')
 OR has_table_privilege('authenticated','public.cart_items','UPDATE')
 OR has_table_privilege('authenticated','public.cart_items','INSERT')
 OR has_table_privilege('authenticated','public.user_place_saves','DELETE') THEN
  RAISE EXCEPTION 'Direct writes can bypass removal markers';
 END IF;
END $$;
SELECT 'PASS mandatory schema version and restricted direct membership mutations';
