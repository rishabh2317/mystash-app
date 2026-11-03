-- Run only through publicationSqlScratch.py against its disposable cluster.
DO $$ BEGIN
 IF has_table_privilege('anon','public.ingest_publication_leases','SELECT')
 OR has_table_privilege('authenticated','public.ingest_publication_leases','UPDATE')
 OR has_function_privilege('authenticated','public.publication_claim(uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.publication_finalize(uuid,uuid,jsonb,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Publication grants leaked'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ingest_publication_leases'::regclass)
 THEN RAISE EXCEPTION 'Publication RLS missing'; END IF;
 IF NOT has_function_privilege('service_role','public.publication_finalize(uuid,uuid,jsonb,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'API cannot finalize'; END IF;
END $$;
SELECT 'PASS private lease grants/RLS and service-only functions';

DO $$ DECLARE i uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); c uuid;
 u uuid:='11111111-1111-4111-8111-111111111111'; other uuid;
BEGIN
 INSERT INTO ingest_requests(id,user_id,source_url,status) VALUES(i,u,'https://fixture.invalid','ready_for_review');
 BEGIN
  PERFORM publication_claim(i,gen_random_uuid(),a);
  RAISE EXCEPTION 'Wrong owner admitted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 IF NOT publication_claim(i,u,a) THEN RAISE EXCEPTION 'Claim failed'; END IF;
 PERFORM set_config('request.headers',jsonb_build_object('x-mystash-publish-ingest',i,'x-mystash-publish-attempt',a)::text,true);
 BEGIN
  INSERT INTO collections(slug,creator_id) VALUES('bad-owner',gen_random_uuid());
  RAISE EXCEPTION 'Wrong creator admitted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO collections(slug,creator_id,status) VALUES('owner-check',u,'ready_for_review') RETURNING id INTO c;
 IF (SELECT collection_id FROM ingest_requests WHERE id=i)<>c THEN RAISE EXCEPTION 'Creation did not link atomically'; END IF;
 PERFORM set_config('request.headers','{}',true);
 INSERT INTO collections(slug,creator_id,status) VALUES('ordinary-unscoped',u,'draft') RETURNING id INTO other;
 BEGIN
  UPDATE ingest_requests SET collection_id=other WHERE id=i;
  RAISE EXCEPTION 'Canonical Collection identity replaced';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT collection_id FROM ingest_requests WHERE id=i)<>c THEN RAISE EXCEPTION 'Identity changed'; END IF;
 PERFORM publication_release(i,a);
END $$;
SELECT 'PASS owner checks, atomic linkage, immutable existing identity, ordinary unscoped writes';

CREATE FUNCTION fixture_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('mystash.test.fail_moderation',true)='on' THEN
  RAISE EXCEPTION 'fixture late finalization failure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_publication_failure BEFORE INSERT ON moderation_actions
 FOR EACH ROW EXECUTE FUNCTION fixture_publication_failure();

DO $$ DECLARE i uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); c uuid; v uuid:=gen_random_uuid();
 u uuid:='11111111-1111-4111-8111-111111111111'; cat uuid; existing_product uuid;
 video jsonb; products jsonb; result jsonb; original_products jsonb;
BEGIN
 INSERT INTO catalog_products(canonical_slug,name,normalized_name) VALUES('fixture-product','Fixture','fixture') RETURNING id INTO cat;
 INSERT INTO ingest_requests(id,user_id,source_url,status) VALUES(i,u,'https://fixture.invalid','ready_for_review');
 IF NOT publication_claim(i,u,a) THEN RAISE EXCEPTION 'Claim failed'; END IF;
 PERFORM set_config('request.headers',jsonb_build_object('x-mystash-publish-ingest',i,'x-mystash-publish-attempt',a)::text,true);
 INSERT INTO collections(slug,creator_id,status,content_revision) VALUES('finalize-rollback',u,'published',1) RETURNING id INTO c;
 -- Creation of an ordinary draft uses ready_for_review in production, followed
 -- by the unchanged CollectionService.publish. Here its completed checkpoint is
 -- already represented by a published Collection to isolate finalizer semantics.
 INSERT INTO videos(id,collection_id,url,product_name) VALUES(v,c,'https://original.invalid','Original product');
 INSERT INTO video_products(video_id,name,price,catalog_product_id) VALUES(v,'Original','10',cat) RETURNING id INTO existing_product;
 video:=jsonb_build_object('id',gen_random_uuid(),'url','https://replacement.invalid','product_name','Replacement',
  'creator_name','fixture','thumbnail','https://image.invalid','stash_score',4.5,'embed_url','https://embed.invalid',
  'video_title','Fixture title','curator_id','@fixture');
 products:=jsonb_build_array(jsonb_build_object('name','Replacement','price','20','image','https://image.invalid',
  'provider','catalog','sort_order',0,'catalog_product_id',cat,'resolution_status','VERIFIED'));
 -- A bad product rolls back the preceding video upsert + deletion of old rows.
 BEGIN
  PERFORM publication_finalize(i,c,video,products||jsonb_build_array(jsonb_build_object('name',NULL,'price','20')));
  RAISE EXCEPTION 'Bad projection accepted';
 EXCEPTION WHEN not_null_violation THEN NULL; END;
 IF (SELECT url FROM videos WHERE id=v)<>'https://original.invalid'
 OR NOT EXISTS(SELECT 1 FROM video_products WHERE id=existing_product)
 OR (SELECT status FROM ingest_requests WHERE id=i)<>'ready_for_review'
 THEN RAISE EXCEPTION 'Projection rollback lost previous state'; END IF;
 -- Fail after the ingest UPDATE: the entire RPC must still roll back.
 PERFORM set_config('mystash.test.fail_moderation','on',true);
 BEGIN
  PERFORM publication_finalize(i,c,video,products);
  RAISE EXCEPTION 'Late failure accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'fixture late finalization failure' THEN RAISE; END IF;
 END;
 PERFORM set_config('mystash.test.fail_moderation','off',true);
 IF (SELECT url FROM videos WHERE id=v)<>'https://original.invalid'
 OR NOT EXISTS(SELECT 1 FROM video_products WHERE id=existing_product)
 OR (SELECT status FROM ingest_requests WHERE id=i)<>'ready_for_review'
 OR EXISTS(SELECT 1 FROM moderation_actions WHERE ingest_request_id=i)
 THEN RAISE EXCEPTION 'Late failure was not fully rolled back'; END IF;
 IF (SELECT status FROM collections WHERE id=c)<>'published' OR (SELECT content_revision FROM collections WHERE id=c)<>1
 THEN RAISE EXCEPTION 'Existing Collection checkpoint changed'; END IF;
 result:=publication_finalize(i,c,video,products);
 IF result->>'videoId'<>v::text OR result->>'collectionId'<>c::text
 OR (SELECT status FROM ingest_requests WHERE id=i)<>'published'
 OR (SELECT video_id FROM ingest_requests WHERE id=i)<>v
 OR (SELECT count(*) FROM videos WHERE collection_id=c)<>1
 THEN RAISE EXCEPTION 'Retry changed publication identity'; END IF;
 SELECT jsonb_agg(to_jsonb(p)) INTO original_products FROM video_products p WHERE video_id=v;
 -- Finalized retries return IDs without rewriting products or moderation facts.
 result:=publication_finalize(i,c,jsonb_build_object('id',gen_random_uuid()),'[]'::jsonb);
 IF result->>'videoId'<>v::text OR (SELECT count(*) FROM moderation_actions WHERE ingest_request_id=i)<>1
 OR (SELECT jsonb_agg(to_jsonb(p)) FROM video_products p WHERE video_id=v)<>original_products
 THEN RAISE EXCEPTION 'Published retry was not idempotent'; END IF;
 PERFORM publication_release(i,a);
END $$;
DROP TRIGGER fixture_publication_failure ON moderation_actions;
DROP FUNCTION fixture_publication_failure();
SELECT 'PASS failed product/late finalization rollback; old projection retained; retry reuses IDs; published retry is a no-op';

DO $$ DECLARE i uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); c uuid;
 u uuid:='11111111-1111-4111-8111-111111111111';
BEGIN
 INSERT INTO ingest_requests(id,user_id,source_url,status) VALUES(i,u,'https://fixture.invalid','ready_for_review');
 IF NOT publication_claim(i,u,a) THEN RAISE EXCEPTION 'Claim failed'; END IF;
 PERFORM set_config('request.headers',jsonb_build_object('x-mystash-publish-ingest',i,'x-mystash-publish-attempt',a)::text,true);
 INSERT INTO collections(slug,creator_id,status) VALUES('scope-check',u,'ready_for_review') RETURNING id INTO c;
 BEGIN
  PERFORM publication_finalize(gen_random_uuid(),c,'{}','[]');
  RAISE EXCEPTION 'Cross-draft finalization accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 UPDATE collections SET status='published' WHERE id=c;
 UPDATE ingest_requests SET status='rejected' WHERE id=i;
 BEGIN
  PERFORM publication_finalize(i,c,'{}','[{}]');
  RAISE EXCEPTION 'Discarded draft published';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.headers','{}',true);
 BEGIN
  PERFORM publication_finalize(i,c,'{}','[{}]');
  RAISE EXCEPTION 'Unscoped finalization accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM publication_release(i,a);
END $$;
SELECT 'PASS finalizer scope and discarded-draft gates';
