-- Runs only inside placesReportingSqlScratch.py's disposable cluster.
CREATE TABLE public.m2_checks(label text PRIMARY KEY,ok boolean NOT NULL CHECK(ok));
CREATE TABLE public.m2_ids(key text PRIMARY KEY,id uuid NOT NULL);
INSERT INTO public.content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','youtube','fixture2','https://example.invalid/2','VIDEO','QUEUED','fixture');
INSERT INTO public.user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform,status,content_source_id)
 VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc','11111111-1111-4111-8111-111111111111','fixture2',
 'https://example.invalid/2','https://example.invalid/2','fixture2','youtube','RECEIVED','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab');
SELECT public.place_upsert_hypothesis('{"content_source_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab","extracted_name":"Fixture cafe","hypothesis_key":"fixture2","unresolved_reason":"ambiguous"}');
INSERT INTO public.m2_ids SELECT 'second_hypothesis',id FROM public.content_source_places WHERE hypothesis_key='fixture2';
SELECT public.place_attach_import('11111111-1111-4111-8111-111111111111',(SELECT id FROM public.m2_ids WHERE key='second_hypothesis'),
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc');
INSERT INTO public.m2_ids SELECT 'second_save',id FROM public.user_place_saves WHERE content_source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
INSERT INTO public.places(id,provider,provider_place_id,name) VALUES('33333333-3333-4333-8333-333333333333','fixture','verified','Fixture cafe');
SELECT public.place_mark_resolved('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333');

CREATE FUNCTION public.m2_fail_merge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('m2.fail_merge',true)='yes' THEN RAISE EXCEPTION 'injected failure' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER m2_fail_merge BEFORE UPDATE ON public.user_place_save_sources FOR EACH ROW EXECUTE FUNCTION public.m2_fail_merge();
DO $$ BEGIN
 PERFORM set_config('m2.fail_merge','yes',true);
 BEGIN
  PERFORM public.place_mark_resolved((SELECT id FROM public.m2_ids WHERE key='second_hypothesis'),'33333333-3333-4333-8333-333333333333');
  RAISE EXCEPTION 'Injected failure did not fire';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.m2_checks VALUES('merge rollback preserves unresolved identity, two cards, and both sources',
  (SELECT resolution_state='unresolved' FROM public.content_source_places WHERE hypothesis_key='fixture2')
  AND (SELECT count(*)=2 FROM public.user_place_saves) AND (SELECT count(*)=2 FROM public.user_place_save_sources));
END $$;
DROP TRIGGER m2_fail_merge ON public.user_place_save_sources;
DROP FUNCTION public.m2_fail_merge();
SELECT public.place_mark_resolved((SELECT id FROM public.m2_ids WHERE key='second_hypothesis'),'33333333-3333-4333-8333-333333333333');
INSERT INTO public.m2_checks VALUES('promotion merges cards but preserves cross-source attribution',
 (SELECT count(*)=1 FROM public.user_place_saves) AND (SELECT count(*)=2 FROM public.user_place_save_sources)
 AND (SELECT count(DISTINCT content_source_id)=2 FROM public.user_place_save_sources));
DO $$ DECLARE result jsonb; BEGIN
 result:=public.place_upgrade_save((SELECT id FROM public.m2_ids WHERE key='second_save'),'33333333-3333-4333-8333-333333333333');
 INSERT INTO public.m2_checks VALUES('retry using merged save id reaches its survivor',result->>'merged'='true');
 BEGIN
  PERFORM public.place_attach_import('22222222-2222-4222-8222-222222222222',
   (SELECT id FROM public.m2_ids WHERE key='second_hypothesis'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc');
  RAISE EXCEPTION 'Wrong owner accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.place_resolve_hypothesis('{"content_source_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab","extracted_name":"Fixture cafe","hypothesis_key":"fixture2","unresolved_reason":"ambiguous"}',
   '{"provider":"fixture","provider_place_id":"wrong-identity","name":"Different place"}');
  RAISE EXCEPTION 'Identity reassignment accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.m2_checks VALUES('failed identity reassignment rolls back canonical insertion',NOT EXISTS(SELECT 1 FROM public.places WHERE provider_place_id='wrong-identity'));
END $$;
SELECT public.place_attach_import('11111111-1111-4111-8111-111111111111',(SELECT id FROM public.m2_ids WHERE key='second_hypothesis'),
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc');
INSERT INTO public.m2_checks VALUES('repeated attachment is idempotent',(SELECT count(*)=2 FROM public.user_place_save_sources));
INSERT INTO public.m2_checks VALUES('new provenance and redirects stay private',
 NOT has_table_privilege('anon','public.user_place_save_sources','SELECT')
 AND NOT has_table_privilege('authenticated','public.place_save_redirects','SELECT')
 AND NOT has_function_privilege('authenticated','public.place_resolve_hypothesis(jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.import_work_claim(uuid,uuid,text,integer)','EXECUTE'));

UPDATE public.content_sources SET processing_status='QUEUED' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
SELECT public.import_work_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','44444444-4444-4444-8444-444444444444','fixture');
INSERT INTO public.m2_checks VALUES('active lease cannot be stolen',public.import_work_claim(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','55555555-5555-4555-8555-555555555555','fixture') IS NULL);
UPDATE public.content_source_import_progress SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE content_source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
INSERT INTO public.m2_checks VALUES('expired worker cannot renew',NOT public.import_work_renew(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','44444444-4444-4444-8444-444444444444'));
SELECT public.import_work_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','55555555-5555-4555-8555-555555555555','fixture');
DO $$ DECLARE t text; BEGIN
 PERFORM set_config('request.headers','{"x-mystash-import-source":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab","x-mystash-import-attempt":"44444444-4444-4444-8444-444444444444"}',true);
 FOREACH t IN ARRAY ARRAY['content_sources','content_source_products','content_source_import_progress','places',
  'content_source_places','user_place_saves','user_place_save_sources','place_save_redirects','cart_items','video_extraction_cache','discovered_products','catalog_products'] LOOP
  BEGIN
   -- Even a no-op DELETE must hit the statement guard before any entity mutation.
   EXECUTE format('DELETE FROM public.%I WHERE false',t);
   RAISE EXCEPTION 'Stale writer accepted on %',t;
  EXCEPTION WHEN SQLSTATE '55000' THEN INSERT INTO public.m2_checks VALUES('stale writer rejected: '||t,true); END;
 END LOOP;
END $$;
SELECT set_config('request.headers','{"x-mystash-import-source":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab","x-mystash-import-attempt":"55555555-5555-4555-8555-555555555555"}',false);
UPDATE public.content_sources SET candidate_count=7 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
SELECT set_config('request.headers','{}',false);
INSERT INTO public.m2_checks VALUES('current owner writes and stale release cannot revoke it',
 (SELECT candidate_count=7 FROM public.content_sources WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'));
SELECT public.import_work_release('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','44444444-4444-4444-8444-444444444444');
INSERT INTO public.m2_checks VALUES('successor remains owner after stale release',public.import_work_current(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','55555555-5555-4555-8555-555555555555'));
SELECT public.import_work_release('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','55555555-5555-4555-8555-555555555555');
INSERT INTO public.m2_checks VALUES('release closes ownership',NOT public.import_work_current(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','55555555-5555-4555-8555-555555555555'));
SELECT 'PASS '||label FROM public.m2_checks ORDER BY label;
