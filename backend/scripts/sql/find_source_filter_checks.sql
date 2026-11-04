DO $$ DECLARE p regprocedure:='public.find_query_by_source(uuid,text,text,integer,timestamptz,uuid)'::regprocedure; BEGIN
  IF has_function_privilege('anon',p,'EXECUTE') OR has_function_privilege('authenticated',p,'EXECUTE')
    OR NOT has_function_privilege('service_role',p,'EXECUTE') THEN RAISE EXCEPTION 'Unsafe source query grants'; END IF;
END $$;

INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version,queued_at)
VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','youtube','filter-completed','https://fixture.invalid/video/1','VIDEO','READY','fixture',now()),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','youtube','filter-processing','https://fixture.invalid/video/2','VIDEO','QUEUED','fixture',now());
INSERT INTO user_imports(user_id,raw_input,source_url,normalized_url,dedupe_key,platform,content_source_id,created_at,stash_sync_state)
SELECT '55555555-5555-4555-8555-555555555555','fixture','https://fixture.invalid/video/'||n,
  'https://fixture.invalid/video/'||n,'find-source-'||n,'youtube',
  CASE WHEN n<=75 THEN 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid ELSE 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid END,
  '2026-11-04T00:00:00.123456Z'::timestamptz,
  CASE WHEN n<=75 THEN 'complete' ELSE 'pending' END
FROM generate_series(1,120) n;
UPDATE user_imports SET stash_sync_state='complete'
WHERE user_id='55555555-5555-4555-8555-555555555555' AND dedupe_key LIKE 'find-source-%'
  AND content_source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555';
  r jsonb; last_stamp timestamptz; last_id uuid; seen uuid[]:=ARRAY[]::uuid[]; entry jsonb;
BEGIN
  LOOP
    r:=find_query_by_source(u,'youtube','completed',17,last_stamp,last_id);
    IF (r->'counts'->>'all')::integer<>120 OR (r->'counts'->>'completed')::integer<>75
      OR (r->'counts'->>'processing')::integer<>45 THEN RAISE EXCEPTION 'Source counts are page-limited or status-scoped: %',r->'counts'; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(r->'items') LOOP
      IF entry->>'sourceType'<>'youtube' OR entry->'outcome'->>'category'<>'completed' THEN RAISE EXCEPTION 'Combined filter leaked row'; END IF;
      IF (entry->>'id')::uuid=ANY(seen) THEN RAISE EXCEPTION 'Source cursor repeated an ID'; END IF;
      seen:=array_append(seen,(entry->>'id')::uuid);
    END LOOP;
    EXIT WHEN r->'cursor'='null'::jsonb;
    last_stamp:=(r->'cursor'->>'created_at')::timestamptz;
    last_id:=(r->'cursor'->>'id')::uuid;
  END LOOP;
  IF cardinality(seen)<>75 THEN RAISE EXCEPTION 'Source cursor skipped rows: %',cardinality(seen); END IF;
  r:=find_query_by_source(u,'youtube','processing',10);
  IF jsonb_array_length(r->'items')<>10 OR (r->'counts'->>'processing')::integer<>45 THEN RAISE EXCEPTION 'Processing source filter broken'; END IF;
  IF (find_query_by_source(u,'image')->'counts'->>'all')::integer<>0 THEN RAISE EXCEPTION 'Empty source count incorrect'; END IF;
  IF (find_query_by_source('22222222-2222-4222-8222-222222222222','youtube')->'counts'->>'all')::integer<>0 THEN RAISE EXCEPTION 'Cross-owner source leak'; END IF;
  IF (find_query(u,'counts')->'counts'->>'all')::integer<>1326 THEN RAISE EXCEPTION 'Legacy global counts changed'; END IF;
  UPDATE user_imports SET hidden_at=now() WHERE dedupe_key='find-source-1';
  IF (find_query_by_source(u,'youtube')->'counts'->>'all')::integer<>119 THEN RAISE EXCEPTION 'Hidden capture leaked'; END IF;
END $$;
SELECT 'PASS source/status filters before pagination, scoped counts, cursor ties, ownership and legacy counts';
