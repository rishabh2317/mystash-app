DO $$ DECLARE p regprocedure; owner uuid:='11111111-1111-4111-8111-111111111111'; other uuid:='22222222-2222-4222-8222-222222222222';
 a jsonb; b jsonb; source uuid; imported uuid; lease uuid:=gen_random_uuid(); detail jsonb;
BEGIN
 IF find_schema_version()<>3 THEN RAISE EXCEPTION 'Missing image schema'; END IF;
 IF (SELECT public FROM storage.buckets WHERE id='find-private-images') THEN RAISE EXCEPTION 'Public image bucket'; END IF;
 IF has_table_privilege('authenticated','find_image_assets','SELECT') THEN RAISE EXCEPTION 'Asset access leaked'; END IF;
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE proname IN ('find_media_command','find_image_attributions','find_claim_image_dispatch') LOOP
  IF has_function_privilege('authenticated',p,'EXECUTE') OR has_function_privilege('anon',p,'EXECUTE') OR NOT has_function_privilege('service_role',p,'EXECUTE') THEN RAISE EXCEPTION 'Image RPC grants leaked'; END IF;
 END LOOP;
 a:=find_media_command(owner,'initialize',NULL,jsonb_build_object('captureId',gen_random_uuid(),'requestDigest',repeat('a',64),'sha256',repeat('b',64),'size',100,'mime','image/jpeg','origin','camera'));
 IF a->>'state'<>'open' OR a->>'user_id'<>owner::text THEN RAISE EXCEPTION 'Allocation failed'; END IF;
 BEGIN PERFORM find_media_command(other,'status',(a->>'id')::uuid); RAISE EXCEPTION 'Foreign asset read'; EXCEPTION WHEN no_data_found THEN NULL; END;
 PERFORM find_media_command(owner,'claim',(a->>'id')::uuid,jsonb_build_object('lease',lease));
 BEGIN PERFORM find_media_command(owner,'claim',(a->>'id')::uuid,jsonb_build_object('lease',gen_random_uuid())); RAISE EXCEPTION 'Competing verifier won'; EXCEPTION WHEN check_violation THEN NULL; END;
 a:=find_media_command(owner,'accept',(a->>'id')::uuid,jsonb_build_object('lease',lease,'digest',repeat('c',64),'width',10,'height',10,'size',100));
 source:=(a->>'source_id')::uuid; imported:=(a->>'import_id')::uuid;
 IF (SELECT owner_id FROM content_sources WHERE id=source)<>owner OR (SELECT canonical_url FROM content_sources WHERE id=source) IS NOT NULL THEN RAISE EXCEPTION 'Private source association failed'; END IF;
 detail:=find_detail(owner,imported);
 IF detail->>'sourceType'<>'image' OR detail->'sourceUrl'<>'null'::jsonb OR detail->'privateMedia'->>'state'<>'available' OR detail::text LIKE '%original.jpg%' THEN RAISE EXCEPTION 'Projection leaked paths'; END IF;
 BEGIN PERFORM find_media_command(other,'media',imported); RAISE EXCEPTION 'Foreign original read'; EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  INSERT INTO user_imports(user_id,platform,raw_input,source_url,normalized_url,dedupe_key,content_source_id) VALUES(other,'image',NULL,NULL,NULL,'illegal',source);
  RAISE EXCEPTION 'Cross-owner image attach';
 EXCEPTION WHEN check_violation THEN NULL; END;
 b:=find_media_command(owner,'initialize',NULL,jsonb_build_object('captureId',gen_random_uuid(),'requestDigest',repeat('d',64),'sha256',repeat('b',64),'size',100,'mime','image/jpeg'));
 PERFORM find_media_command(owner,'claim',(b->>'id')::uuid,jsonb_build_object('lease',lease));
 b:=find_media_command(owner,'accept',(b->>'id')::uuid,jsonb_build_object('lease',lease,'digest',repeat('c',64),'width',10,'height',10,'size',100));
 IF b->>'state'<>'duplicate' OR b->>'import_id'<>imported::text THEN RAISE EXCEPTION 'Same-account normalized dedupe failed'; END IF;
 b:=find_media_command(other,'initialize',NULL,jsonb_build_object('captureId',gen_random_uuid(),'requestDigest',repeat('e',64),'sha256',repeat('b',64),'size',100,'mime','image/jpeg'));
 PERFORM find_media_command(other,'claim',(b->>'id')::uuid,jsonb_build_object('lease',lease));
 b:=find_media_command(other,'accept',(b->>'id')::uuid,jsonb_build_object('lease',lease,'digest',repeat('c',64),'width',10,'height',10,'size',100));
 IF b->>'source_id'=source::text THEN RAISE EXCEPTION 'Cross-account dedupe leaked image'; END IF;
 UPDATE content_sources SET processing_status='QUEUED' WHERE id=source;
 PERFORM import_work_claim(source,lease,'fixture');
 UPDATE user_imports SET hidden_at=clock_timestamp() WHERE id=imported;
 PERFORM set_config('request.headers',jsonb_build_object('x-mystash-import-source',source,'x-mystash-import-attempt',lease)::text,true);
 BEGIN PERFORM import_work_assert();RAISE EXCEPTION 'Deleted image worker retained ownership';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 PERFORM set_config('request.headers','{}',true);
 BEGIN PERFORM find_media_command(owner,'media',imported); RAISE EXCEPTION 'Hidden image readable'; EXCEPTION WHEN no_data_found THEN NULL; END;
 IF (SELECT state FROM find_image_assets WHERE id=(a->>'id')::uuid)<>'deleting' THEN RAISE EXCEPTION 'Deletion not durable'; END IF;
 IF find_image_attributions(owner,ARRAY[source])->0->>'label'<>'Original image removed' THEN RAISE EXCEPTION 'Attribution fallback missing'; END IF;
 -- Signed upload capabilities remain usable until expiration. Do not finish physical cleanup early.
 PERFORM find_media_command(NULL,'cleanupClaim',NULL,jsonb_build_object('lease',lease));
 PERFORM find_media_command(NULL,'cleanupFinish',(a->>'id')::uuid,jsonb_build_object('lease',lease,'state','deleting'));
 IF (SELECT state FROM find_image_assets WHERE id=(a->>'id')::uuid)<>'deleting' THEN RAISE EXCEPTION 'Permanent deletion before upload capability expiry'; END IF;
 UPDATE find_image_assets SET upload_expires_at=clock_timestamp()-interval '1 hour',verify_until=NULL,cleanup_after=clock_timestamp() WHERE source_id=source;
 PERFORM find_media_command(NULL,'cleanupClaim',NULL,jsonb_build_object('lease',lease));
 PERFORM find_media_command(NULL,'cleanupFinish',(a->>'id')::uuid,jsonb_build_object('lease',lease,'state','deleting'));
 IF (SELECT state FROM find_image_assets WHERE id=(a->>'id')::uuid)<>'deleted' THEN RAISE EXCEPTION 'Deletion ack failed'; END IF;
 -- Soft account deletion schedules retained private bytes before any account cascades.
 UPDATE users SET account_status='DELETED',deleted_at=clock_timestamp() WHERE id=other;
 IF EXISTS(SELECT 1 FROM find_image_assets WHERE user_id=other AND state='accepted') THEN RAISE EXCEPTION 'Account deletion left media available'; END IF;
 DELETE FROM auth.users WHERE id=other;
 IF NOT EXISTS(SELECT 1 FROM find_image_assets WHERE user_id=other AND state='deleting') THEN RAISE EXCEPTION 'Hard deletion lost durable storage cleanup'; END IF;
 RAISE NOTICE 'PASS image ownership, grants, source constraints, normalized dedupe, projections, cancellation and cleanup state';
END $$;
SELECT 'PASS image ownership, grants, normalized account-scoped dedupe, source constraints, late worker fencing and deletion state';
-- Even a later accidentally broad permissive policy cannot expose the private bucket.
CREATE POLICY fixture_broad_read ON storage.objects FOR SELECT TO authenticated USING(true);
INSERT INTO storage.objects(bucket_id,name) VALUES('find-private-images','private-fixture'),('profile-photos','public-fixture');
SET ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='find-private-images') THEN RAISE EXCEPTION 'Storage RLS leaked image'; END IF; END $$;
RESET ROLE;
SELECT 'PASS restrictive Storage RLS blocks broad client policies';
DO $$ DECLARE owner uuid:='11111111-1111-4111-8111-111111111111'; capture uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid();
 input jsonb; asset jsonb; original_path text; baseline_count bigint; prior_import uuid;
BEGIN
 input:=jsonb_build_object('captureId',capture,'requestDigest',repeat('8',64),'sha256',repeat('9',64),'size',100,'mime','image/jpeg');
 asset:=find_media_command(owner,'initialize',NULL,input);original_path:=asset->>'staging_path';
 UPDATE find_image_assets SET upload_expires_at=clock_timestamp()-interval '1 hour' WHERE id=(asset->>'id')::uuid;
 PERFORM find_media_command(NULL,'cleanupClaim',NULL,jsonb_build_object('lease',lease));
 PERFORM find_media_command(NULL,'cleanupFinish',(asset->>'id')::uuid,jsonb_build_object('lease',lease,'state','deleting'));
 asset:=find_media_command(owner,'initialize',NULL,input);
 IF asset->>'state'<>'open' OR asset->>'staging_path'=original_path THEN RAISE EXCEPTION 'Expired never-accepted capture cannot resume safely'; END IF;
 BEGIN PERFORM find_media_command(owner,'claim',(asset->>'id')::uuid);RAISE EXCEPTION 'Null verifier lease accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM find_media_command(owner,'claim',(asset->>'id')::uuid,jsonb_build_object('lease',lease));
 BEGIN PERFORM find_media_command(owner,'accept',(asset->>'id')::uuid,jsonb_build_object('lease',gen_random_uuid(),'digest',repeat('6',64),'width',10,'height',10,'size',100));RAISE EXCEPTION 'Stale verifier accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT count(*) INTO baseline_count FROM content_sources WHERE owner_id=owner;
 SELECT id INTO prior_import FROM user_imports WHERE user_id=owner LIMIT 1;
 -- Reproduce a URL/image capture-ID race after image claim. Receipt uniqueness must roll back source + import too.
 INSERT INTO share_acceptance_receipts(user_id,capture_id,payload_digest,import_id,reply) VALUES(owner,capture,repeat('7',64),prior_import,'{}');
 BEGIN
  PERFORM find_media_command(owner,'accept',(asset->>'id')::uuid,jsonb_build_object('lease',lease,'digest',repeat('6',64),'width',10,'height',10,'size',100));
  RAISE EXCEPTION 'Conflicting receipt accepted';
 EXCEPTION WHEN unique_violation THEN NULL;END;
 IF (SELECT count(*) FROM content_sources WHERE owner_id=owner)<>baseline_count OR (SELECT state FROM find_image_assets WHERE id=(asset->>'id')::uuid)<>'verifying' THEN RAISE EXCEPTION 'Image acceptance partially committed'; END IF;
 PERFORM find_media_command(owner,'cancel',(asset->>'id')::uuid);
 UPDATE find_image_assets SET upload_expires_at=clock_timestamp()-interval '1 hour',verify_until=NULL,cleanup_until=NULL,cleanup_after=clock_timestamp() WHERE id=(asset->>'id')::uuid;
 PERFORM find_media_command(NULL,'cleanupClaim',NULL,jsonb_build_object('lease',lease));
 PERFORM find_media_command(NULL,'cleanupFinish',(asset->>'id')::uuid,jsonb_build_object('lease',lease,'state','deleting'));
 IF find_media_command(owner,'initialize',NULL,input)->>'state'<>'deleted' THEN RAISE EXCEPTION 'Cancelled capture reopened'; END IF;
END $$;
SELECT 'PASS expired-upload resume with fresh immutable paths, cancelled-capture fencing, verifier lease validation and atomic receipt conflict rollback';
