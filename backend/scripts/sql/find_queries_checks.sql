DO $$ DECLARE p regprocedure; BEGIN
 IF find_schema_version()<>2 THEN RAISE EXCEPTION 'Missing Phase 2 schema'; END IF;
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'find_%' LOOP
  IF has_function_privilege('anon',p,'EXECUTE') OR has_function_privilege('authenticated',p,'EXECUTE') OR NOT has_function_privilege('service_role',p,'EXECUTE')
  THEN RAISE EXCEPTION 'Unsafe RPC grants: %',p; END IF;
 END LOOP;
END $$;
INSERT INTO auth.users VALUES('55555555-5555-4555-8555-555555555555');
INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
 VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','web','find-history','https://fixture.invalid/history','WEB_PAGE','READY','fixture');
INSERT INTO user_imports(user_id,raw_input,source_url,normalized_url,dedupe_key,platform,content_source_id,created_at)
 SELECT '55555555-5555-4555-8555-555555555555','fixture','https://fixture.invalid/'||n,'https://fixture.invalid/'||n,'find-page-'||n,'web',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-11-03T00:00:00.123456Z'::timestamptz-CASE WHEN n<=600 THEN interval '0' ELSE interval '0.000001 second' END FROM generate_series(1,1205) n;
UPDATE user_imports SET stash_sync_state='complete' WHERE user_id='55555555-5555-4555-8555-555555555555';
DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555'; reply jsonb; last_stamp timestamptz; last_id uuid; seen uuid[]:=ARRAY[]::uuid[]; entry jsonb; BEGIN
 LOOP
  reply:=find_query(u,'list',50,last_stamp,last_id);
  IF (reply->'counts'->>'all')::integer<>1205 OR (reply->'counts'->>'completed')::integer<>1205 THEN RAISE EXCEPTION 'Count truncated to page'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(reply->'items') LOOP
   IF (entry->>'id')::uuid=ANY(seen) THEN RAISE EXCEPTION 'Duplicate paginated ID'; END IF;
   seen:=array_append(seen,(entry->>'id')::uuid);
  END LOOP;
  EXIT WHEN reply->'cursor'='null'::jsonb;
  last_stamp:=(reply->'cursor'->>'created_at')::timestamptz; last_id:=(reply->'cursor'->>'id')::uuid;
 END LOOP;
 IF cardinality(seen)<>1205 THEN RAISE EXCEPTION 'Microsecond cursor skipped records: %',cardinality(seen); END IF;
 IF jsonb_array_length(find_query(u,'batch',20,NULL,NULL,'all',seen[1000:1099])->'items')<>100 THEN RAISE EXCEPTION 'Loaded older batch truncated'; END IF;
 IF jsonb_array_length(find_query('22222222-2222-4222-8222-222222222222','batch',20,NULL,NULL,'all',seen[1:10])->'items')<>0 THEN RAISE EXCEPTION 'Cross-owner batch leak'; END IF;
 BEGIN PERFORM find_detail('22222222-2222-4222-8222-222222222222',seen[1]); RAISE EXCEPTION 'Cross-owner detail leak'; EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555'; i uuid; p uuid; r jsonb; BEGIN
 SELECT id INTO i FROM user_imports WHERE user_id=u LIMIT 1;
 UPDATE content_sources SET processing_status='QUEUED',queued_at=statement_timestamp() WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 r:=find_query(u,'list',1,NULL,NULL,'processing');
 IF (r->'counts'->>'processing')::integer<>1205 OR jsonb_array_length(r->'items')<>1 THEN RAISE EXCEPTION 'Unloaded active count lost'; END IF;
 INSERT INTO catalog_products(id) VALUES('99999999-9999-4999-8999-999999999999');
 INSERT INTO content_source_products(content_source_id,external_id,name,extraction_method,processor_version,catalog_product_id)
 VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','history-product','History fixture','cache','fixture','99999999-9999-4999-8999-999999999999') RETURNING id INTO p;
 PERFORM find_result_action(u,i,'product',p,true,'c:99999999-9999-4999-8999-999999999999');
 r:=find_query(u,'list',1,NULL,NULL,'saved');
 IF (r->'counts'->>'saved')::integer<>1205 OR (r->'counts'->>'processing')::integer<>1205 OR jsonb_array_length(r->'items')<>1 THEN RAISE EXCEPTION 'Saved/filter categories conflated'; END IF;
 UPDATE content_sources SET queued_at=statement_timestamp()-interval '15 minutes' WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 IF (find_query(u,'counts')->'counts'->>'attention')::integer<>1205 THEN RAISE EXCEPTION 'Delayed outcome count disagrees'; END IF;
 PERFORM find_result_action(u,i,'product',p,false,'c:99999999-9999-4999-8999-999999999999');
 UPDATE content_sources SET processing_status='READY' WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 UPDATE user_imports SET stash_sync_state='complete' WHERE user_id=u;
END $$;
SELECT 'PASS 1205-record history, microsecond ties, global counts and older-page batch ownership';

-- A separate source keeps large detail projections independent of the history fixture.
INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
 VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','web','find-detail','https://fixture.invalid/detail','WEB_PAGE','READY','fixture');
INSERT INTO user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform,content_source_id)
 VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','55555555-5555-4555-8555-555555555555','fixture','https://fixture.invalid/detail','https://fixture.invalid/detail','find-detail','web','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
INSERT INTO content_source_products(content_source_id,position,external_id,name,extraction_method,processor_version,catalog_product_id)
 SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',n,'detail-'||n,'Fixture product','cache','fixture','44444444-4444-4444-8444-444444444444' FROM generate_series(0,1004) n;
DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555'; i uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; s uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; p uuid; h uuid; d jsonb; BEGIN
 SELECT id INTO p FROM content_source_products WHERE content_source_id=s ORDER BY position LIMIT 1;
 PERFORM find_result_action(u,i,'product',p,true,'c:44444444-4444-4444-8444-444444444444');
 UPDATE user_imports SET stash_sync_state='complete' WHERE id=i;
 d:=find_detail(u,i);
 IF jsonb_array_length(d->'products')<>1005 OR (d->'outcome'->>'foundProducts')::integer<>1 OR (d->'outcome'->>'savedProducts')::integer<>1 THEN RAISE EXCEPTION 'Detail truncated or identity count incorrect'; END IF;
 BEGIN PERFORM find_result_action(u,i,'product',p,false,'c:99999999-9999-4999-8999-999999999999');
  RAISE EXCEPTION 'Stale product identity mutated a new binding'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM find_result_action(u,i,'product',p,false,'c:44444444-4444-4444-8444-444444444444');
 d:=find_detail(u,i);
 IF (d->'outcome'->>'foundProducts')::integer<>1 OR (d->'outcome'->>'savedProducts')::integer<>0 OR NOT (d->'products'->0->>'removed')::boolean THEN RAISE EXCEPTION 'Removal conflates extraction and active saving'; END IF;
 PERFORM find_cart_put(u,'44444444-4444-4444-8444-444444444444',NULL,jsonb_build_object('source_surface','USER_IMPORT','source_user_import_id',i,'source_content_source_id',s),true);
 IF (find_detail(u,i)->'outcome'->>'savedProducts')::integer<>0 THEN RAISE EXCEPTION 'Worker resurrected removed product'; END IF;
 PERFORM find_result_action(u,i,'product',p,true,'c:44444444-4444-4444-8444-444444444444');
 IF (find_query(u,'counts')->'counts'->>'saved')::integer<>1 THEN RAISE EXCEPTION 'Saved count ignores global memberships'; END IF;
 BEGIN PERFORM find_result_action('22222222-2222-4222-8222-222222222222',i,'product',p,false,'c:44444444-4444-4444-8444-444444444444'); RAISE EXCEPTION 'Cross-owner result action'; EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN PERFORM find_result_action(u,(SELECT id FROM user_imports WHERE dedupe_key='find-page-1'), 'product',p,false,'c:44444444-4444-4444-8444-444444444444'); RAISE EXCEPTION 'Cross-Find result action'; EXCEPTION WHEN no_data_found THEN NULL; END;
 INSERT INTO content_source_places(content_source_id,extracted_name,resolution_state,unresolved_reason,hypothesis_key)
 VALUES(s,'Fixture cafe','unresolved','ambiguous','find-detail-place') RETURNING id INTO h;
 PERFORM find_result_action(u,i,'place',h,false);
 PERFORM place_attach_import(u,h,s,i);
 IF (find_detail(u,i)->'outcome'->>'savedPlaces')::integer<>0 THEN RAISE EXCEPTION 'Worker resurrected place'; END IF;
 PERFORM find_result_action(u,i,'place',h,true);
 IF (find_detail(u,i)->'outcome'->>'savedPlaces')::integer<>1 THEN RAISE EXCEPTION 'Place restoration failed'; END IF;
 UPDATE user_imports SET hidden_at=now() WHERE id=i;
 BEGIN PERFORM find_detail(u,i); RAISE EXCEPTION 'Hidden Find leaked'; EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN PERFORM find_result_action(u,i,'place',h,true); RAISE EXCEPTION 'Hidden Find mutated'; EXCEPTION WHEN no_data_found THEN NULL; END;
 IF (SELECT count(*) FROM cart_items WHERE user_id=u AND removed_at IS NULL)<>1 THEN RAISE EXCEPTION 'Hiding Find deleted Stash'; END IF;
END $$;
SELECT 'PASS complete detail beyond row cap, distinct found/saved counts, actions, restoration and history hiding';

DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555'; i uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 s uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; p uuid; lease uuid:=gen_random_uuid(); key text:=repeat('a',64); d jsonb; BEGIN
 UPDATE user_imports SET hidden_at=NULL WHERE id=i;
 INSERT INTO catalog_products(id) VALUES('88888888-8888-4888-8888-888888888888');
 INSERT INTO content_source_products(content_source_id,position,external_id,name,extraction_method,processor_version,match_assessment)
 VALUES(s,1005,'selected-similar','Similar candidate','cache','fixture',jsonb_build_object('kind','similar','suggestions',jsonb_build_array(jsonb_build_object('key',key)))) RETURNING id INTO p;
 PERFORM share_review_claim(u,i,p,key,lease,false);
 PERFORM find_accept_suggestion(u,i,p,key,lease,'88888888-8888-4888-8888-888888888888',NULL);
 UPDATE user_imports SET stash_sync_state='complete' WHERE id=i;
 d:=find_detail(u,i);
 IF (d->'outcome'->>'foundProducts')::integer<>2 OR (d->'outcome'->>'savedProducts')::integer<>2
 OR d->'savedSuggestions'->0->>'matchKind'<>'similar' THEN RAISE EXCEPTION 'Accepted similar product not counted or relabeled exact'; END IF;
 PERFORM find_result_action(u,i,'product',p,false,'c:88888888-8888-4888-8888-888888888888',key);
 -- Replay of a committed Save receipt must never restore a subsequent removal.
 PERFORM find_accept_suggestion(u,i,p,key,lease,'88888888-8888-4888-8888-888888888888',NULL);
 IF (find_detail(u,i)->'outcome'->>'savedProducts')::integer<>1 THEN RAISE EXCEPTION 'Suggestion replay resurrected removal'; END IF;
 PERFORM find_result_action(u,i,'product',p,true,'c:88888888-8888-4888-8888-888888888888',key);
 IF (find_detail(u,i)->'outcome'->>'savedProducts')::integer<>2 THEN RAISE EXCEPTION 'Accepted similar restoration failed'; END IF;
 PERFORM find_result_action(u,i,'product',p,false,'c:88888888-8888-4888-8888-888888888888',key);
END $$;
SELECT 'PASS accepted similar counts, explicit restoration and atomic Save receipt replay after removal';

-- Deliberately invalid receipt work is confined to a rolled-back fixture transaction.
BEGIN;
CREATE FUNCTION pg_temp.reject_find_fixture_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state='accepted' AND NEW.candidate_key=repeat('b',64) THEN RAISE EXCEPTION 'fixture_receipt_failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER find_fixture_receipt BEFORE UPDATE ON user_import_product_reviews
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_find_fixture_receipt();
DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555'; i uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 s uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; p uuid; lease uuid:=gen_random_uuid(); key text:=repeat('b',64); BEGIN
 INSERT INTO content_source_products(content_source_id,position,external_id,name,extraction_method,processor_version,match_assessment)
 VALUES(s,1006,'expired-save','Expired save fixture','cache','fixture',jsonb_build_object('kind','similar','suggestions',jsonb_build_array(jsonb_build_object('key',key)))) RETURNING id INTO p;
 PERFORM share_review_claim(u,i,p,key,lease,false);
 UPDATE user_import_product_reviews SET lease_until=clock_timestamp()-interval '1 second' WHERE import_id=i AND source_product_id=p;
 BEGIN PERFORM find_accept_suggestion(u,i,p,key,lease,'88888888-8888-4888-8888-888888888888',NULL);
  RAISE EXCEPTION 'Expired Save lease committed'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM cart_items WHERE user_id=u AND catalog_product_id='88888888-8888-4888-8888-888888888888' AND removed_at IS NULL)
 OR EXISTS(SELECT 1 FROM user_import_product_reviews WHERE source_product_id=p AND state='accepted') THEN RAISE EXCEPTION 'Failed Save was partially committed'; END IF;
 UPDATE user_import_product_reviews SET lease_until=clock_timestamp()+interval '1 minute' WHERE import_id=i AND source_product_id=p;
 BEGIN PERFORM find_accept_suggestion(u,i,p,key,lease,'88888888-8888-4888-8888-888888888888',NULL);
  RAISE EXCEPTION 'Fixture did not reject receipt'; EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'fixture_receipt_failure' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM cart_items WHERE user_id=u AND catalog_product_id='88888888-8888-4888-8888-888888888888' AND removed_at IS NULL)
 THEN RAISE EXCEPTION 'Receipt failure left a committed restoration'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS expired leases and forced receipt failure cannot partially commit membership';
