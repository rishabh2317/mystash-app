DO $$ DECLARE s uuid:='99999999-9999-4999-8999-999999999999'; a uuid:=gen_random_uuid();
BEGIN
 INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
 VALUES(s,'youtube','find-work-guard-fixture','https://example.com/fixture','VIDEO','QUEUED','fixture');
 PERFORM import_work_claim(s,a,'fixture');
 PERFORM set_config('request.headers',jsonb_build_object('x-mystash-import-source',s,'x-mystash-import-attempt',a)::text,true);
 PERFORM import_work_assert();
 UPDATE content_sources SET processing_status='READY' WHERE id=s;
 PERFORM set_config('request.headers','{}',true);
 PERFORM import_work_release(s,a);
END $$;
SELECT 'PASS active non-image import lease can write under private-image guards';
