DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('find_query_by_source_kind','find_source_saved_rows','find_source_results','find_source_summaries') LOOP
  IF has_function_privilege('anon',p,'EXECUTE') OR has_function_privilege('authenticated',p,'EXECUTE')
    OR NOT has_function_privilege('service_role',p,'EXECUTE') THEN RAISE EXCEPTION 'Unsafe source projection grant: %',p; END IF;
 END LOOP;
END $$;

DO $$ DECLARE u uuid:='55555555-5555-4555-8555-555555555555';
 i uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; p uuid; h uuid; a jsonb; b jsonb; c jsonb; original_image text;
BEGIN
 SELECT id INTO p FROM content_source_products WHERE content_source_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  AND catalog_product_id='44444444-4444-4444-8444-444444444444' ORDER BY position LIMIT 1;
 SELECT id INTO h FROM content_source_places WHERE content_source_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND retired_at IS NULL LIMIT 1;
 PERFORM find_result_action(u,i,'product',p,true,'c:44444444-4444-4444-8444-444444444444');
 PERFORM find_result_action(u,i,'place',h,true);
 a:=find_source_summaries(u,'product',10);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'items') row WHERE row->>'id'=i::text
   AND (row->>'savedProducts')::integer>=1 AND (row->>'savedPlaces')::integer>=1
   AND jsonb_array_length(row->'images') BETWEEN 1 AND 4) THEN RAISE EXCEPTION 'Saved source summary missing'; END IF;
 IF jsonb_array_length(find_source_summaries('22222222-2222-4222-8222-222222222222','product',10)->'items')<>0
 THEN RAISE EXCEPTION 'Cross-owner source summary'; END IF;
 SELECT image INTO original_image FROM content_source_products WHERE id=p;
 UPDATE content_source_products SET image='https://find-private-images.invalid/private.jpg?token=secret' WHERE id=p;
 a:=find_source_summaries(u,'product',10);
 IF a::text LIKE '%find-private-images%' OR find_source_results(u,i,10)::text LIKE '%find-private-images%'
 THEN RAISE EXCEPTION 'Private image URL leaked in Stash source projection'; END IF;
 UPDATE content_source_products SET image='https://user:secret@example.invalid/a.jpg' WHERE id=p;
 IF find_source_summaries(u,'product',10)::text LIKE '%user:secret%'
   OR find_source_results(u,i,10)::text LIKE '%user:secret%'
 THEN RAISE EXCEPTION 'Credential-bearing media URL leaked in Stash source projection'; END IF;
 UPDATE content_source_products SET image=original_image WHERE id=p;
 a:=find_source_results(u,i,1);
 IF jsonb_array_length(a->'items')<>1 OR a->>'cursor' IS NULL THEN RAISE EXCEPTION 'Source results page 1'; END IF;
 b:=find_source_results(u,i,1,a->>'cursor');
 IF jsonb_array_length(b->'items')<>1 OR b->'items'->0=a->'items'->0 THEN RAISE EXCEPTION 'Source results page 2'; END IF;
 c:=find_query_by_source_kind(u,'web','product','all',10);
 IF (c->'counts'->>'all')::integer<1 THEN RAISE EXCEPTION 'Saved kind filter missing'; END IF;
 IF (find_query_by_source_kind(u,'youtube','product')->'counts'->>'all')::integer<>0
 THEN RAISE EXCEPTION 'Saved kind leaked source'; END IF;
 PERFORM find_result_action(u,i,'product',p,false,'c:44444444-4444-4444-8444-444444444444');
 PERFORM find_result_action(u,i,'place',h,false);
 IF jsonb_array_length(find_source_results(u,i,10)->'items')<>0 THEN RAISE EXCEPTION 'Removed item in source results'; END IF;
 IF jsonb_array_length(find_source_summaries(u,'product',10)->'items')<>0 THEN RAISE EXCEPTION 'Removed source still shown'; END IF;
 BEGIN PERFORM find_source_results('22222222-2222-4222-8222-222222222222',i,10);
  RAISE EXCEPTION 'Cross-owner source results';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
SELECT 'PASS saved source summaries/results, keyset pages, kind/source filters, removal, ownership and grants';
