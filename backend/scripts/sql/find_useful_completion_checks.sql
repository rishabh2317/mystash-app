DO $$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('find_schema_version','find_project_outcome','find_outcome_memberships','find_detail') LOOP
  IF has_function_privilege('anon',p,'EXECUTE') OR has_function_privilege('authenticated',p,'EXECUTE') OR NOT has_function_privilege('service_role',p,'EXECUTE') THEN RAISE EXCEPTION 'Unsafe release RPC grants: %',p; END IF;
 END LOOP;
END $$;
-- Existing isolated owner/import fixture. Store only a descriptor, never a fake catalogue identity.
BEGIN;
UPDATE content_sources SET processing_status='READY' WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
INSERT INTO content_source_products(content_source_id,external_id,name,brand,evidence,extraction_method,processor_version)
 VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','discovery-check','Black mini dress','ZARA',
 '{"discoveryEligible":true,"attributes":[{"attribute":"brand","value":"ZARA","origin":"source_text"}],"privateField":"must-not-be-projected"}','cache','fixture');
DO $$ DECLARE d jsonb; BEGIN
 d:=find_detail('55555555-5555-4555-8555-555555555555','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 IF (d->'outcome'->>'discoveryProducts')::int<>1 THEN RAISE EXCEPTION 'Missing separate discovery count'; END IF;
 IF d::text LIKE '%must-not-be-projected%' THEN RAISE EXCEPTION 'Raw evidence leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'products') p WHERE p->>'title'='Black mini dress' AND p->'identityKey'='null'::jsonb AND p->'discoverySeed'->>'brand'='ZARA') THEN RAISE EXCEPTION 'Descriptor falsely bound or brand evidence missing'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS release RPC grants, separate discovery counts, descriptor identity and evidence privacy';
